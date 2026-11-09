import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowError } from "@/domain/workflow/errors";
import { createTestDb, type TestDb } from "@/test/db";
import { saveFinding } from "../findings";
import { loadTurnover } from "../turnover-store";
import { createTurnover, runCommand } from "../workflow";
import {
  addFiles,
  addLink,
  canSeeTurnover,
  finishUploads,
  findVisibleAttachment,
  listAttachments,
  removeAttachment,
  startUploads,
} from "./attachments";
import { LocalFileStore } from "./store";

let t: TestDb;
let dir: string;
let store: LocalFileStore;
let turnoverId: string;
let inspectionId: string;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const photo = (name = "kitchen.jpg") => ({ name, type: "image/jpeg", data: JPEG });

beforeEach(async () => {
  t = await createTestDb();
  dir = await mkdtemp(path.join(tmpdir(), "uploads-"));
  store = new LocalFileStore(dir);
  const created = await createTurnover(
    t.db,
    { propertyId: t.propertyIds.get("Acadian")!, unit: "203", moveOutDate: "2026-11-02" },
    { actor: t.as(t.ids.admin) },
  );
  turnoverId = created.turnover.id;
  inspectionId = created.turnover.steps[0].id;
});
afterEach(async () => {
  await t.handle.close();
  await rm(dir, { recursive: true, force: true });
});

const inspector = () => ({ personId: t.ids.inspector, isManager: false });
const crew = () => ({ personId: t.ids.crew, isManager: false });
const manager = () => ({ personId: t.ids.admin, isManager: true });

describe("photos", () => {
  it("lets the inspector add photos to their inspection, stored per unit and step", async () => {
    const [id] = await addFiles(t.db, store, inspector(), { turnoverId, stepId: inspectionId }, [photo()]);
    const [row] = await listAttachments(t.db, turnoverId);
    expect(row).toMatchObject({ id, kind: "photo", stepId: inspectionId, storageKey: `turnovers/${turnoverId}/${inspectionId}/${id}.jpg` });
    expect((await store.get(row.storageKey!))?.data).toEqual(Buffer.from(JPEG));
  });

  it("only lets people add to their own step while it's their turn", async () => {
    await expect(addFiles(t.db, store, crew(), { turnoverId, stepId: inspectionId }, [photo()])).rejects.toThrow(/own task/);
    const workId = (await loadTurnover(t.db, turnoverId))!.steps[2].id;
    await expect(addFiles(t.db, store, crew(), { turnoverId, stepId: workId }, [photo()])).rejects.toThrow(/own task/);
    await expect(addFiles(t.db, store, manager(), { turnoverId, stepId: workId }, [photo()])).resolves.toHaveLength(1);
  });

  it("refuses files that aren't photos or PDFs, and empty or huge ones", async () => {
    await expect(addFiles(t.db, store, inspector(), { turnoverId, stepId: inspectionId }, [{ name: "x.exe", type: "application/x-msdownload", data: JPEG }])).rejects.toThrow(
      /isn't a photo or PDF/,
    );
    await expect(addFiles(t.db, store, inspector(), { turnoverId, stepId: inspectionId }, [{ ...photo(), data: new Uint8Array() }])).rejects.toThrow(/empty/);
  });

  it("shows a unit's photos only to managers and whoever has the active step", async () => {
    const [id] = await addFiles(t.db, store, inspector(), { turnoverId, stepId: inspectionId }, [photo()]);
    expect(await canSeeTurnover(t.db, inspector(), turnoverId)).toBe(true);
    expect(await findVisibleAttachment(t.db, crew(), id)).toBeNull();
    expect(await findVisibleAttachment(t.db, manager(), id)).not.toBeNull();
    // When the inspection is done, the inspector no longer sees the unit; the next person does.
    await runCommand(t.db, turnoverId, { type: "complete", stepId: inspectionId }, { actor: t.as(t.ids.inspector) });
    expect(await findVisibleAttachment(t.db, inspector(), id)).toBeNull();
  });

  it("ties photos to a finding, and removing a finding hides its photos", async () => {
    const findingId = await saveFinding(t.db, t.as(t.ids.inspector), {
      turnoverId,
      stepId: inspectionId,
      room: "Kitchen",
      description: "Cracked tile",
      needsWork: true,
    });
    const [id] = await addFiles(t.db, store, inspector(), { turnoverId, stepId: inspectionId, findingId }, [photo()]);
    expect((await listAttachments(t.db, turnoverId))[0]).toMatchObject({ id, findingId });
    await expect(
      addFiles(t.db, store, inspector(), { turnoverId, stepId: inspectionId, findingId: "00000000-0000-4000-8000-000000000000" }, [photo()]),
    ).rejects.toThrow(/finding no longer exists/);
  });

  it("lets people remove only what they added", async () => {
    const [mine] = await addFiles(t.db, store, inspector(), { turnoverId, stepId: inspectionId }, [photo()]);
    const [managers] = await addFiles(t.db, store, manager(), { turnoverId, stepId: inspectionId }, [photo()]);
    await expect(removeAttachment(t.db, inspector(), managers)).rejects.toBeInstanceOf(WorkflowError);
    await removeAttachment(t.db, inspector(), mine);
    expect((await listAttachments(t.db, turnoverId)).map((a) => a.id)).toEqual([managers]);
  });
});

describe("links", () => {
  it("accepts web links only", async () => {
    await addLink(t.db, inspector(), { turnoverId, stepId: inspectionId, url: "https://www.dropbox.com/sh/abc", caption: "Finals" });
    await expect(addLink(t.db, inspector(), { turnoverId, stepId: inspectionId, url: "javascript:alert(1)" })).rejects.toThrow(/https/);
    await expect(addLink(t.db, inspector(), { turnoverId, stepId: inspectionId, url: "dropbox folder" })).rejects.toThrow(/whole link/);
    expect((await listAttachments(t.db, turnoverId))[0]).toMatchObject({ kind: "link", url: "https://www.dropbox.com/sh/abc", caption: "Finals" });
  });
});

/** A stand-in for Supabase Storage: remembers what browsers "uploaded" straight to it. */
class DirectStore extends LocalFileStore {
  readonly arrived = new Map<string, number>();
  async createUpload(key: string, contentType: string) {
    return { url: `https://storage.example.com/upload/${key}?token=t`, method: "PUT" as const, headers: { "Content-Type": contentType } };
  }
  async stat(key: string) {
    const size = this.arrived.get(key);
    return size === undefined ? null : { size, contentType: "image/jpeg" };
  }
}

describe("uploads straight to storage", () => {
  const jpeg = (size = 1000) => ({ name: "kitchen.jpg", type: "image/jpeg", size });
  let direct: DirectStore;
  beforeEach(() => {
    direct = new DirectStore(dir);
  });

  it("hands out one address per file, then records the files that arrived", async () => {
    const target = { turnoverId, stepId: inspectionId };
    const [planned] = await startUploads(t.db, direct, inspector(), target, [jpeg()]);
    expect(planned.key).toMatch(new RegExp(`^turnovers/${turnoverId}/${inspectionId}/[0-9a-f-]{36}\\.jpg$`));
    expect(planned.upload).toEqual({ url: `https://storage.example.com/upload/${planned.key}?token=t`, method: "PUT", headers: { "Content-Type": "image/jpeg" } });
    expect(await listAttachments(t.db, turnoverId)).toEqual([]); // nothing is recorded until it arrives

    direct.arrived.set(planned.key, 1234);
    const [id] = await finishUploads(t.db, direct, inspector(), target, [{ key: planned.key, name: "kitchen.jpg", type: "image/jpeg" }]);
    expect(planned.key).toContain(id);
    const [row] = await listAttachments(t.db, turnoverId);
    expect(row).toMatchObject({ id, kind: "photo", storageKey: planned.key, sizeBytes: 1234, uploadedById: t.ids.inspector });
  });

  it("checks the person before handing out any address", async () => {
    await expect(startUploads(t.db, direct, crew(), { turnoverId, stepId: inspectionId }, [jpeg()])).rejects.toThrow(/own task/);
    await expect(startUploads(t.db, direct, inspector(), { turnoverId, stepId: inspectionId }, [{ ...jpeg(), type: "text/html" }])).rejects.toThrow(
      /isn't a photo or PDF/,
    );
  });

  it("only records files that really arrived, at addresses given out for that step", async () => {
    const target = { turnoverId, stepId: inspectionId };
    const [planned] = await startUploads(t.db, direct, inspector(), target, [jpeg()]);
    const finish = (key: string, type = "image/jpeg") => finishUploads(t.db, direct, inspector(), target, [{ key, name: "kitchen.jpg", type }]);

    await expect(finish(planned.key)).rejects.toThrow(/didn't finish uploading/);
    direct.arrived.set(planned.key, 1000);
    const workId = (await loadTurnover(t.db, turnoverId))!.steps[2].id;
    await expect(finish(planned.key.replace(inspectionId, workId))).rejects.toThrow(/wrong/);
    await expect(finish(planned.key, "image/png")).rejects.toThrow(/wrong/);
    await expect(finish("turnovers/../../etc/passwd.jpg")).rejects.toThrow(/wrong/);

    direct.arrived.set(planned.key, 30 * 1024 * 1024);
    await expect(finish(planned.key)).rejects.toThrow(/over 25 MB/);
    direct.arrived.set(planned.key, 1000);
    await finish(planned.key);
    await expect(finish(planned.key)).rejects.toThrow(/already added/);
  });
});
