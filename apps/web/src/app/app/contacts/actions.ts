'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createContact,
  updateContact,
  setContactArchived,
  deleteContact,
  mergeContacts,
  importContacts,
  type ImportResult,
} from '@st/core';
import { db } from '@/lib/db';
import { requireUser, requireWorkspace, requestMeta } from '@/lib/session';
import { toFormError, type ActionState } from '@/lib/action-result';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const fromForm = (fd: FormData) => ({
  name: str(fd, 'name'),
  email: str(fd, 'email'),
  phone: str(fd, 'phone'),
  company: str(fd, 'company'),
  jobTitle: str(fd, 'jobTitle'),
  contactType: str(fd, 'contactType') as 'person',
  notes: str(fd, 'notes'),
  tags: str(fd, 'tags'),
  visibility: str(fd, 'visibility') === 'private' ? ('private' as const) : ('shared' as const),
});

export async function saveContactAction(
  contactId: string | null,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const { user, membership } = await requireWorkspace();
  const meta = await requestMeta();
  try {
    if (contactId) await updateContact(db(), { userId: user.id }, contactId, fromForm(fd), meta);
    else
      await createContact(db(), { userId: user.id }, membership.workspace.id, fromForm(fd), meta);
  } catch (err) {
    return toFormError(err);
  }
  revalidatePath('/app/contacts', 'layout');
  return { ok: true, message: contactId ? 'Contact saved.' : 'Contact added.' };
}

export async function contactAction(
  contactId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const meta = await requestMeta();
  const intent = str(fd, 'intent');
  try {
    if (intent === 'archive' || intent === 'unarchive')
      await setContactArchived(db(), { userId: user.id }, contactId, intent === 'archive', meta);
    else if (intent === 'delete') await deleteContact(db(), { userId: user.id }, contactId, meta);
    else if (intent === 'merge')
      await mergeContacts(db(), { userId: user.id }, contactId, str(fd, 'otherId'), meta);
  } catch (err) {
    return toFormError(err);
  }
  revalidatePath('/app/contacts', 'layout');
  if (intent === 'delete') redirect('/app/contacts');
  return {
    ok: true,
    message:
      intent === 'archive'
        ? 'Contact archived.'
        : intent === 'unarchive'
          ? 'Contact restored.'
          : 'Contacts merged.',
  };
}

export type ImportState = (ActionState & { result?: ImportResult }) | null;

export async function importAction(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const { user, membership } = await requireWorkspace();
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, message: 'Choose a CSV file.' };
  if (file.size > 1_000_000)
    return { ok: false, message: 'The file is too large. Import up to 1 MB at a time.' };
  try {
    const result = await importContacts(
      db(),
      { userId: user.id },
      membership.workspace.id,
      await file.text(),
      await requestMeta(),
    );
    revalidatePath('/app/contacts');
    return {
      ok: true,
      message: `Imported ${result.created} ${result.created === 1 ? 'contact' : 'contacts'}${result.skipped.length ? `; skipped ${result.skipped.length}` : ''}.`,
      result,
    };
  } catch (err) {
    return toFormError(err);
  }
}
