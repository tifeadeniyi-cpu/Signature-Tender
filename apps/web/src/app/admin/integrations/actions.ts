'use server';
import { revalidatePath } from 'next/cache';
import { AppError, setIntegrationAvailability, type Availability } from '@st/core';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/session';

const STATES = ['available', 'beta', 'coming_soon', 'maintenance', 'unavailable'];

export async function setAvailabilityAction(
  _prev: unknown,
  form: FormData,
): Promise<{ ok: boolean; message: string }> {
  const staff = await requireStaff();
  const provider = String(form.get('provider') ?? '');
  const raw = String(form.get('availability') ?? '');
  const availability =
    raw === 'default' ? null : STATES.includes(raw) ? (raw as Availability) : undefined;
  if (availability === undefined) return { ok: false, message: 'Choose an availability.' };
  try {
    await setIntegrationAvailability(db(), { userId: staff.id }, provider, availability);
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    throw err;
  }
  revalidatePath('/admin/integrations');
  revalidatePath('/app/integrations', 'layout');
  return { ok: true, message: 'Saved.' };
}
