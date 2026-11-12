'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addTemplateCategory,
  saveTemplateDetails,
  saveTemplateRecipients,
  saveTemplateFields,
  saveTemplateSettings,
  publishTemplate,
  discardTemplateDraft,
  setTemplateStatus,
  duplicateTemplate,
  createDocumentFromTemplate,
  getConfigValue,
  type TemplateIssue,
} from '@st/core';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { requireUser, requireWorkspace, requestMeta } from '@/lib/session';
import { toFormError, type ActionState } from '@/lib/action-result';

type Roles = Parameters<typeof saveTemplateRecipients>[3];
type Fields = Parameters<typeof saveTemplateFields>[3];
type Settings = Parameters<typeof saveTemplateSettings>[3];

async function run(
  templateId: string,
  fn: (actor: { userId: string }) => Promise<unknown>,
  okMessage: string,
): Promise<ActionState> {
  const user = await requireUser();
  try {
    await fn({ userId: user.id });
  } catch (err) {
    return toFormError(err);
  }
  revalidatePath(`/app/templates/${templateId}`, 'layout');
  revalidatePath('/app/templates');
  return { ok: true, message: okMessage };
}

export async function saveTemplateDetailsAction(
  templateId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const meta = await requestMeta();
  return run(
    templateId,
    (actor) =>
      saveTemplateDetails(
        db(),
        actor,
        templateId,
        {
          title: String(fd.get('title') ?? ''),
          description: String(fd.get('description') ?? ''),
          category: String(fd.get('category') ?? ''),
          documentType: String(fd.get('documentType') ?? ''),
          shared: fd.get('shared') === 'on',
        },
        meta,
      ),
    'Details saved.',
  );
}

export async function saveTemplateRolesAction(
  templateId: string,
  input: Roles,
): Promise<ActionState> {
  const meta = await requestMeta();
  const maxSigners = await getConfigValue(db(), 'limits.max_signers_per_request', 5);
  return run(
    templateId,
    (actor) => saveTemplateRecipients(db(), actor, templateId, input, { maxSigners }, meta),
    'Roles saved.',
  );
}

export async function saveTemplateFieldsAction(
  templateId: string,
  input: Fields,
): Promise<ActionState> {
  const meta = await requestMeta();
  return run(
    templateId,
    (actor) => saveTemplateFields(db(), actor, templateId, input, meta),
    'Fields saved.',
  );
}

export async function saveTemplateSettingsAction(
  templateId: string,
  input: Settings,
): Promise<ActionState> {
  const meta = await requestMeta();
  return run(
    templateId,
    (actor) => saveTemplateSettings(db(), actor, templateId, input, meta),
    'Settings saved.',
  );
}

export type PublishState = (ActionState & { issues?: TemplateIssue[] }) | null;

export async function publishTemplateAction(templateId: string): Promise<PublishState> {
  const user = await requireUser();
  try {
    const res = await publishTemplate(db(), { userId: user.id }, templateId, await requestMeta());
    if (!res.ok) return { ok: false, message: 'Fix these before publishing.', issues: res.issues };
    revalidatePath(`/app/templates/${templateId}`, 'layout');
    revalidatePath('/app/templates');
    return { ok: true, message: `Version ${res.version} published. New documents will use it.` };
  } catch (err) {
    return toFormError(err);
  }
}

export async function templateAction(
  templateId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const meta = await requestMeta();
  const intent = String(fd.get('intent') ?? '');
  let goTo: string | null = null;
  try {
    const actor = { userId: user.id };
    if (intent === 'discard') await discardTemplateDraft(db(), actor, templateId, meta);
    else if (intent === 'archive' || intent === 'unarchive' || intent === 'delete') {
      await setTemplateStatus(db(), actor, templateId, intent, meta);
      if (intent === 'delete') goTo = '/app/templates';
    } else if (intent === 'duplicate') {
      const { id } = await duplicateTemplate(db(), actor, templateId, meta);
      goTo = `/app/templates/${id}`;
    } else return { ok: false, message: 'Unknown action.' };
  } catch (err) {
    return toFormError(err);
  }
  revalidatePath('/app/templates', 'layout');
  if (goTo) redirect(goTo);
  return {
    ok: true,
    message:
      intent === 'discard'
        ? 'Unpublished changes discarded.'
        : intent === 'archive'
          ? 'Template archived.'
          : 'Template restored.',
  };
}

export async function addCategoryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user, membership } = await requireWorkspace();
  try {
    await addTemplateCategory(
      db(),
      { userId: user.id },
      membership.workspace.id,
      String(fd.get('name') ?? ''),
      await requestMeta(),
    );
  } catch (err) {
    return toFormError(err);
  }
  revalidatePath('/app/templates', 'layout');
  return { ok: true, message: 'Category added.' };
}

export async function useTemplateAction(
  templateId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const ids = fd.getAll('placeholderId').map(String);
  let documentId: string;
  try {
    ({ documentId } = await createDocumentFromTemplate(
      db(),
      storage(),
      { userId: user.id },
      templateId,
      {
        title: String(fd.get('title') ?? ''),
        recipients: ids.map((id) => ({
          placeholderId: id,
          name: String(fd.get(`name_${id}`) ?? ''),
          email: String(fd.get(`email_${id}`) ?? ''),
        })),
      },
      await requestMeta(),
    ));
  } catch (err) {
    return toFormError(err);
  }
  revalidatePath('/app/documents');
  redirect(`/app/documents/${documentId}/prepare/review`);
}
