import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { loadTemplate } from "@/server/workflow";
import { Section } from "../../section";
import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "Edit workflow" };

export default function TemplateEditorPage(props: PageProps<"/settings/templates/[id]">) {
  return (
    <Section
      title="Edit workflow"
      path="/settings/templates"
      description={
        <>
          Steps run in order; a step marked &quot;runs alongside the step before&quot; starts with it, and the next step waits for both.{" "}
          <Link href="/settings/templates" className="text-primary hover:underline">
            Back to workflows
          </Link>
        </>
      }
    >
      {async () => {
        const { id } = await props.params;
        if (!z.uuid().safeParse(id).success) notFound();
        const template = await loadTemplate(await getDb(), id).catch(() => null);
        if (!template) notFound();
        return (
          <TemplateEditor
            templateId={template.template.id}
            name={template.template.name}
            steps={template.steps.map(({ position: _p, ...s }) => s)}
          />
        );
      }}
    </Section>
  );
}
