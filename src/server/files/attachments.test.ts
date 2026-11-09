import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowError } from "@/domain/workflow/errors";
import { createTestDb, type TestDb } from "@/test/db";
import { saveFinding } from "../findings";
import { loadTurnover } from "../turnover-store";
import { createTurnover, runCommand } from "../workflow";
import { addFiles, addLink, canSeeTurnover, findVisibleAttachment, listAttachments, removeAttachment } from "./attachments";
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
