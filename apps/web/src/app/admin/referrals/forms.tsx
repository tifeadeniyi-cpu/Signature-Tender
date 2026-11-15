'use client';
import { useActionState } from 'react';
import { cn } from '@/lib/cn';
import {
  adjustCreditsAction,
  linkStatusAction,
  reviewReferralAction,
  saveProgramAction,
} from './actions';
import type { ReferralProgram } from '@st/core';

type Result = { ok: boolean; message: string } | null;

function Status({ state }: { state: Result }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      className={cn('text-xs', state.ok ? 'text-success' : 'text-error')}
    >
      {state.message}
    </p>
  );
}

const input = 'h-8 rounded-md border border-border bg-white px-2 text-sm';
const btn = 'h-8 rounded-md px-3 text-xs font-semibold';

export function ReviewForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(reviewReferralAction, null);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`note-${id}`}>
        Review note
      </label>
      <input
        id={`note-${id}`}
        name="note"
        placeholder="Note (required to reject)"
        maxLength={500}
        className={input}
      />
      <div className="flex gap-1">
        <button
          name="decision"
          value="approve"
          disabled={pending}
          className={cn(btn, 'bg-success text-white')}
        >
          Approve
        </button>
        <button
          name="decision"
          value="reject"
          disabled={pending}
          className={cn(btn, 'bg-error text-white')}
        >
          Reject
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function LinkStatusForm({ identityId, status }: { identityId: string; status: string }) {
  const [state, action, pending] = useActionState(linkStatusAction, null);
  const revoke = status === 'active';
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="identityId" value={identityId} />
      <input type="hidden" name="status" value={revoke ? 'revoked' : 'active'} />
      {revoke ? (
        <>
          <label className="sr-only" htmlFor={`reason-${identityId}`}>
            Reason
          </label>
          <input
            id={`reason-${identityId}`}
            name="reason"
            placeholder="Reason"
            maxLength={500}
            className={input}
          />
        </>
      ) : null}
      <button disabled={pending} className={cn(btn, 'border border-border bg-white text-heading')}>
        {revoke ? 'Revoke link' : 'Restore link'}
      </button>
      <Status state={state} />
    </form>
  );
}

export function AdjustForm() {
  const [state, action, pending] = useActionState(adjustCreditsAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_120px_1fr_auto] sm:items-end">
      <label className="flex flex-col gap-1 text-sm">
        Workspace ID
        <input
          name="workspaceId"
          required
          className={input}
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Credits (+/-)
        <input name="delta" type="number" min={-100} max={100} required className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Reason
        <input name="reason" required maxLength={500} className={input} />
      </label>
      <button disabled={pending} className={cn(btn, 'h-8 bg-primary text-white')}>
        Record adjustment
      </button>
      <div className="sm:col-span-4">
        <Status state={state} />
      </div>
    </form>
  );
}

export function ProgramForm({ program }: { program: ReferralProgram }) {
  const [state, action, pending] = useActionState(saveProgramAction, null);
  const s = program.settings;
  const field = 'flex flex-col gap-1 text-sm';
  const box = 'h-9 rounded-md border border-border bg-white px-2 text-sm';
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <label className={field}>
        Status
        <select name="status" defaultValue={program.status} className={box}>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="ended">Ended</option>
        </select>
      </label>
      <label className={field}>
        Program name
        <input name="name" defaultValue={program.name} maxLength={80} className={box} />
      </label>
      <label className={field}>
        Referrer reward (credits)
        <input
          name="referrerCredits"
          type="number"
          min={0}
          max={20}
          defaultValue={program.referrerCredits}
          className={box}
        />
      </label>
      <label className={field}>
        New customer reward (credits)
        <input
          name="referredCredits"
          type="number"
          min={0}
          max={20}
          defaultValue={program.referredCredits}
          className={box}
        />
      </label>
      <label className={field}>
        Link attribution window (days)
        <input
          name="attributionWindowDays"
          type="number"
          min={1}
          max={365}
          defaultValue={program.attributionWindowDays}
          className={box}
        />
      </label>
      <label className={field}>
        Settlement hold before referrer reward (hours)
        <input
          name="qualificationDelayHours"
          type="number"
          min={0}
          max={1440}
          defaultValue={program.qualificationDelayHours}
          className={box}
        />
      </label>
      <label className={field}>
        Velocity flag (referred sign-ups per link per day)
        <input
          name="velocityPerDay"
          type="number"
          min={1}
          max={1000}
          defaultValue={s.velocityPerDay}
          className={box}
        />
      </label>
      <label className={field}>
        Program terms URL
        <input name="termsUrl" defaultValue={s.termsUrl} maxLength={300} className={box} />
      </label>
      <fieldset className="flex flex-col gap-2 text-sm sm:col-span-2">
        <legend className="mb-1 font-semibold">Switches</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="signupRewardEnabled"
            defaultChecked={s.signupRewardEnabled}
          />{' '}
          Welcome credit for new customers
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="referrerRewardEnabled"
            defaultChecked={s.referrerRewardEnabled}
          />{' '}
          Reward for referrers
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="fraudReviewEnabled" defaultChecked={s.fraudReviewEnabled} />{' '}
          Hold referrals with risk signals for review
        </label>
      </fieldset>
      <label className={cn(field, 'sm:col-span-2')}>
        Share message
        <textarea
          name="shareMessage"
          defaultValue={s.shareMessage}
          maxLength={400}
          rows={3}
          className="rounded-md border border-border bg-white p-2 text-sm"
        />
      </label>
      <label className={cn(field, 'sm:col-span-2')}>
        Invite page message
        <input
          name="landingMessage"
          defaultValue={s.landingMessage}
          maxLength={300}
          className={box}
        />
      </label>
      <label className={cn(field, 'sm:col-span-2')}>
        Extra disposable email domains (space or comma separated)
        <textarea
          name="extraDisposableDomains"
          defaultValue={s.extraDisposableDomains.join(' ')}
          rows={2}
          className="rounded-md border border-border bg-white p-2 text-sm"
        />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          disabled={pending}
          className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white"
        >
          Save program
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}
