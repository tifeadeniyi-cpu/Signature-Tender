import Image from 'next/image';
import type { ReactNode } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  FileSignature,
  FileText,
  FolderOpen,
  Hash,
  LayoutDashboard,
  ListChecks,
  PenLine,
  Plug,
  Search,
  Settings,
  Type,
  Users,
  UserRound,
  BookUser,
  ShieldCheck,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { DemoLabel, StatusPill, type Status } from './primitives';

/** Same sections as the app sidebar. */
const SIDEBAR = [
  [LayoutDashboard, 'Dashboard'],
  [FileText, 'Documents'],
  [FileSignature, 'Templates'],
  [BookUser, 'Contacts'],
  [Users, 'Team'],
  [CreditCard, 'Billing & Credits'],
  [Plug, 'Integrations'],
  [Settings, 'Settings'],
] as const;

export function AppFrame({
  active,
  children,
  className,
  compact,
  interactive,
}: {
  active: string;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  /** Contains real controls (a demo), so it must stay visible to assistive technology. */
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-white/20 bg-white text-left text-heading shadow-2xl ring-1 ring-black/5',
        className,
      )}
      aria-hidden={interactive ? undefined : true}
    >
      <div
        className="flex items-center gap-1.5 border-b border-border bg-ivory px-3 py-2"
        aria-hidden
      >
        <span className="size-2.5 rounded-full bg-[#F28B82]" />
        <span className="size-2.5 rounded-full bg-[#FBD38D]" />
        <span className="size-2.5 rounded-full bg-[#9AE6B4]" />
        <span className="ml-3 truncate rounded-md bg-white px-2 py-0.5 text-[10px] text-slate-text">
          signaturetender.com/app
        </span>
      </div>
      <div className="flex">
        {compact ? null : (
          <div className="hidden w-36 shrink-0 flex-col gap-0.5 bg-primary p-2 text-white sm:flex">
            <Image
              src="/brand/logo-reversed.png"
              alt=""
              width={327}
              height={168}
              className="mb-2 h-auto w-24 rounded-md"
            />
            {SIDEBAR.map(([Icon, label]) => (
              <span
                key={label}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-[10px]',
                  label === active ? 'bg-white/15 font-semibold text-white' : 'text-white/75',
                )}
              >
                <Icon className="size-3" /> {label}
              </span>
            ))}
          </div>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

const STEPS = ['Document', 'Signers', 'Fields', 'Settings', 'Review'];

export function PrepareSteps({ current = 2 }: { current?: number }) {
  return (
    <ol className="flex flex-wrap gap-1.5 text-[10px]">
      {STEPS.map((s, i) => (
        <li
          key={s}
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-0.5',
            i < current && 'bg-primary-surface text-primary',
            i === current && 'bg-primary font-semibold text-white',
            i > current && 'text-slate-text',
          )}
        >
          <span className="font-semibold">{i + 1}</span> {s}
          {i < current ? <CheckCircle2 className="size-3" /> : null}
        </li>
      ))}
    </ol>
  );
}

/** A page of a fictional agreement with grey text lines. */
export function PaperPage({
  title,
  children,
  className,
}: {
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('relative rounded-md border border-border bg-white p-4 shadow-sm', className)}
    >
      <p className="text-center font-display text-sm text-heading">{title}</p>
      <div className="mt-3 flex flex-col gap-1.5">
        {[92, 100, 86, 97, 74, 100, 88, 60].map((w, i) => (
          <span key={i} className="h-1.5 rounded bg-slate-200" style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-1.5">
        {[100, 83, 95, 70].map((w, i) => (
          <span key={i} className="h-1.5 rounded bg-slate-200" style={{ width: `${w}%` }} />
        ))}
      </div>
      {children}
    </div>
  );
}

const FIELD_TYPES = [
  [PenLine, 'Signature'],
  [Type, 'Initials'],
  [Calendar, 'Date signed'],
  [FileText, 'Text'],
  [ListChecks, 'Checkbox'],
  [Hash, 'Number'],
] as const;

export function HeroComposition({ signatureFont }: { signatureFont: string }) {
  return (
    <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
      <AppFrame active="Documents" className="relative">
        <div className="p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-sm sm:text-base">Prepare document</p>
            <div className="flex gap-1.5">
              <span className="rounded-md border border-border px-2 py-0.5 text-[10px]">
                Save draft
              </span>
              <span className="rounded-md bg-primary px-2 py-0.5 text-[10px] text-white">
                Continue
              </span>
            </div>
          </div>
          <div className="mt-2">
            <PrepareSteps />
          </div>
          <div className="mt-3 grid grid-cols-[1fr_96px] gap-3">
            <PaperPage title="Service Agreement" className="min-h-48">
              <span className="absolute bottom-6 left-6 flex h-9 w-36 items-center justify-center rounded border-2 border-dashed border-[#D69E2E] bg-[#FEFCBF]/80 text-[11px] font-semibold text-[#975A16]">
                <PenLine className="mr-1 size-3" /> Signature
              </span>
              <span className="absolute bottom-6 right-6 flex h-9 w-20 items-center justify-center rounded border-2 border-dashed border-sky-400 bg-sky-50/80 text-[10px] font-semibold text-sky-700">
                Date
              </span>
            </PaperPage>
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-semibold">Add fields</p>
              {FIELD_TYPES.map(([Icon, label]) => (
                <span
                  key={label}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-white px-1.5 py-1 text-[10px]"
                >
                  <Icon className="size-3 text-primary" /> {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </AppFrame>

      <div
        className="absolute -bottom-10 -left-2 w-56 rounded-2xl border border-border bg-white p-3 text-heading shadow-2xl sm:-left-8 sm:w-64"
        aria-hidden
      >
        <p className="text-[11px] font-semibold text-primary">Signature Studio</p>
        <p
          className="mt-1 truncate text-4xl leading-tight text-primary-dark"
          style={{ fontFamily: signatureFont }}
        >
          Jordan Rivera
        </p>
        <div className="mt-1 h-px bg-gradient-to-r from-rose-gold to-transparent" />
      </div>

      <div
        className="absolute -right-2 -top-6 hidden w-52 rounded-2xl border border-border bg-white p-3 text-heading shadow-2xl sm:block lg:-right-6"
        aria-hidden
      >
        <p className="text-[11px] font-semibold">Signing progress</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full w-2/3 rounded-full bg-success" />
        </div>
        <p className="mt-1.5 text-[10px] text-slate-text">2 of 3 signers done</p>
        <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-success-bg px-2 py-1 text-[10px] font-semibold text-success">
          <CheckCircle2 className="size-3.5" /> Completed copy and certificate ready
        </div>
      </div>
    </div>
  );
}

const DOCS: { name: string; recipients: string; progress: string; status: Status; date: string }[] =
  [
    {
      name: 'Service Agreement',
      recipients: 'Avery Lane, Sam Ortiz',
      progress: '2 of 2',
      status: 'completed',
      date: 'Nov 9',
    },
    {
      name: 'Employment Contract',
      recipients: 'Riley Chen',
      progress: '0 of 1',
      status: 'pending',
      date: 'Nov 8',
    },
    {
      name: 'Vendor NDA',
      recipients: 'Morgan Blake, Kai Patel',
      progress: '1 of 2',
      status: 'pending',
      date: 'Nov 7',
    },
    {
      name: 'Consulting Agreement',
      recipients: 'Taylor Brooks',
      progress: '1 of 1',
      status: 'completed',
      date: 'Nov 5',
    },
    {
      name: 'Equipment Lease',
      recipients: 'Jamie Fox',
      progress: '0 of 1',
      status: 'declined',
      date: 'Nov 3',
    },
    { name: 'Venue Rider', recipients: '—', progress: '—', status: 'draft', date: 'Nov 2' },
  ];

export function DocumentsMock() {
  const tabs = ['All Documents', 'In Progress', 'Completed', 'Drafts', 'Expired'];
  return (
    <figure className="flex flex-col gap-2">
      <AppFrame active="Documents">
        <div className="p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-base">Documents</p>
            <span className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-slate-text">
              <Search className="size-3" /> Search title, signer or reference
            </span>
          </div>
          <div className="mt-3 flex gap-3 overflow-x-auto border-b border-border text-[11px]">
            {tabs.map((t, i) => (
              <span
                key={t}
                className={cn(
                  'whitespace-nowrap pb-1.5',
                  i === 0
                    ? 'border-b-2 border-primary font-semibold text-heading'
                    : 'text-slate-text',
                )}
              >
                {t}
              </span>
            ))}
          </div>
          <table className="mt-2 w-full text-left text-[11px]">
            <thead className="text-slate-text">
              <tr>
                <th className="py-1.5 font-medium">Document</th>
                <th className="hidden py-1.5 font-medium sm:table-cell">Recipients</th>
                <th className="py-1.5 font-medium">Signed</th>
                <th className="py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {DOCS.map((d) => (
                <tr key={d.name} className="border-t border-border">
                  <td className="py-2 pr-2">
                    <span className="flex items-center gap-1.5 font-medium text-heading">
                      <FileText className="size-3.5 shrink-0 text-primary" /> {d.name}
                    </span>
                    <span className="text-[10px] text-slate-text">Updated {d.date}</span>
                  </td>
                  <td className="hidden py-2 pr-2 text-slate-text sm:table-cell">{d.recipients}</td>
                  <td className="py-2 pr-2 text-slate-text">{d.progress}</td>
                  <td className="py-2">
                    <StatusPill status={d.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AppFrame>
      <figcaption>
        <DemoLabel />
      </figcaption>
    </figure>
  );
}

const TEMPLATES = [
  ['Service Agreement', 'Business', 2],
  ['Non-Disclosure Agreement', 'Legal', 2],
  ['Employment Offer', 'HR', 1],
  ['Contractor Agreement', 'Business', 2],
  ['Artist Agreement', 'Music', 3],
  ['Vendor Agreement', 'Procurement', 2],
] as const;

export function TemplatesMock() {
  return (
    <figure className="flex flex-col gap-2">
      <AppFrame active="Templates">
        <div className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <p className="font-display text-base">Templates</p>
            <span className="rounded-md bg-primary px-2 py-1 text-[10px] text-white">
              New template
            </span>
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TEMPLATES.map(([name, cat, roles]) => (
              <li key={name} className="rounded-lg border border-border p-2.5">
                <FileSignature className="size-4 text-primary" />
                <p className="mt-1.5 text-[11px] font-semibold leading-tight">{name}</p>
                <p className="mt-1 text-[10px] text-slate-text">
                  {cat} · {roles} {roles === 1 ? 'role' : 'roles'}
                </p>
                <span className="mt-1.5 inline-block rounded-full bg-success-bg px-1.5 text-[9px] font-semibold text-success">
                  Published
                </span>
              </li>
            ))}
          </ul>
        </div>
      </AppFrame>
      <figcaption>
        <DemoLabel />
      </figcaption>
    </figure>
  );
}

const MEMBERS = [
  ['Avery Lane', 'Owner', 'Internal'],
  ['Sam Ortiz', 'Admin', 'Internal'],
  ['Riley Chen', 'Editor', 'Internal'],
  ['Morgan Blake', 'Billing Administrator', 'Internal'],
  ['Kai Patel', 'Viewer', 'External'],
] as const;

export function TeamMock() {
  return (
    <figure className="flex flex-col gap-2">
      <AppFrame active="Team">
        <div className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <p className="font-display text-base">Team</p>
            <span className="rounded-md bg-primary px-2 py-1 text-[10px] text-white">
              Invite member
            </span>
          </div>
          <div className="mt-3 flex gap-3 border-b border-border text-[11px]">
            {['All', 'Internal', 'External', 'Pending', 'Roles', 'Groups'].map((t, i) => (
              <span
                key={t}
                className={cn(
                  'pb-1.5',
                  i === 0 ? 'border-b-2 border-primary font-semibold' : 'text-slate-text',
                )}
              >
                {t}
              </span>
            ))}
          </div>
          <ul className="mt-1">
            {MEMBERS.map(([name, role, access]) => (
              <li
                key={name}
                className="flex items-center justify-between gap-2 border-b border-border py-2 text-[11px] last:border-0"
              >
                <span className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary-surface text-primary">
                    <UserRound className="size-3.5" />
                  </span>
                  <span className="font-medium">{name}</span>
                </span>
                <span className="flex items-center gap-2 text-slate-text">
                  <span className="hidden sm:inline">{access}</span>
                  <span className="rounded-full bg-blush px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {role}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </AppFrame>
      <figcaption>
        <DemoLabel />
      </figcaption>
    </figure>
  );
}

/** Completed-request evidence card used in the security section. */
export function EvidenceMock() {
  return (
    <div
      className="rounded-2xl border border-white/15 bg-white/5 p-5 text-white backdrop-blur"
      aria-hidden
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="size-4 text-rose-gold" /> Evidence certificate
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px] text-white/80">
        <dt>Signed PDF</dt>
        <dd className="truncate font-mono">sha256 9f2c…a71e</dd>
        <dt>Certificate</dt>
        <dd className="truncate font-mono">sha256 41bd…0c93</dd>
      </dl>
      <ol className="mt-4 flex flex-col gap-2 border-l border-rose-gold/50 pl-3 text-[11px]">
        {[
          'Request sent',
          'Invitation emailed',
          'Link opened',
          'Agreed to sign electronically',
          'Signed',
          'Completed: copy and certificate created',
        ].map((e) => (
          <li key={e} className="flex items-center gap-2">
            <ChevronRight className="size-3 text-rose-gold" /> {e}
          </li>
        ))}
      </ol>
      <p className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2 py-1 text-[11px]">
        <Download className="size-3" /> Download the certificate PDF
      </p>
      <p className="mt-3 text-[10px] text-white/60">
        <FolderOpen className="mr-1 inline size-3" />
        Product demonstration · fictional data
      </p>
    </div>
  );
}
