import type { ReactNode } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Send,
  UserRound,
  XCircle,
  CircleDashed,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { CheckList, Eyebrow, Heading, Section, StatusPill, type Status } from './primitives';
import { DocumentsMock, TeamMock, TemplatesMock } from './mocks';
import { PrepDemo } from './prep-demo';
import { StudioDemo, type StudioFamily } from './studio-demo';
import { TrackedLink } from './tracked-link';
import { Reveal } from './reveal';

function Cta({
  href,
  children,
  dark,
  event,
}: {
  href: string;
  children: ReactNode;
  dark?: boolean;
  event?: 'pricing_cta_clicked' | 'api_docs_clicked';
}) {
  return (
    <TrackedLink
      href={href}
      event={event}
      className={cn(
        'mt-8 inline-flex h-12 items-center gap-2 rounded-xl px-6 font-semibold transition',
        dark
          ? 'bg-rose-gold text-primary-dark hover:bg-blush'
          : 'bg-primary text-white hover:bg-primary-hover',
      )}
    >
      {children} <ArrowRight className="size-4" aria-hidden />
    </TrackedLink>
  );
}

/** Two-column spotlight: visual on one side, copy on the other (alternating). */
export function FeatureSpotlight({
  id,
  name,
  tone,
  eyebrow,
  title,
  sub,
  visual,
  children,
  reverse,
}: {
  id: string;
  name: string;
  tone?: 'light' | 'blush' | 'dark' | 'white';
  eyebrow: string;
  title: ReactNode;
  sub: ReactNode;
  visual: ReactNode;
  children: ReactNode;
  reverse?: boolean;
}) {
  const dark = tone === 'dark';
  return (
    <Section id={id} tone={tone} labelledBy={`${id}-heading`}>
      <Reveal name={name}>
        <div
          className={cn(
            'grid items-center gap-12 lg:grid-cols-2 lg:gap-16',
            reverse && 'lg:[&>*:first-child]:order-2',
          )}
        >
          <div className="min-w-0">{visual}</div>
          <div>
            <Eyebrow dark={dark}>{eyebrow}</Eyebrow>
            <div className="mt-4">
              <Heading id={`${id}-heading`} dark={dark} sub={sub}>
                {title}
              </Heading>
            </div>
            <div className="mt-8">{children}</div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

export function DocumentPreparationSpotlight({
  startHref,
  signatureFont,
}: {
  startHref: string;
  signatureFont: string;
}) {
  return (
    <FeatureSpotlight
      id="prepare"
      name="document_preparation"
      tone="white"
      eyebrow="DOCUMENT PREPARATION"
      title="Prepare Documents in Minutes, Not Hours."
      sub="Create a signature-ready agreement using an intuitive document editor designed for simplicity."
      visual={<PrepDemo signatureFont={signatureFont} />}
    >
      <CheckList
        columns
        items={[
          'PDF upload',
          'Drag-and-drop field placement',
          'Multiple signers',
          'Recipient assignment',
          'Required fields',
          'Initials and dates',
          'Text, checkbox and dropdown fields',
          'Field resizing',
          'Document preview',
          'Save draft',
          'Signing order',
        ]}
      />
      <Cta href={startHref}>Prepare Your First Document</Cta>
    </FeatureSpotlight>
  );
}

export function SignatureStudioSpotlight({
  families,
  startHref,
}: {
  families: StudioFamily[];
  startHref: string;
}) {
  return (
    <Section id="signature-studio" tone="dark" labelledBy="studio-heading" className="py-4">
      <svg
        aria-hidden
        viewBox="0 0 800 400"
        className="pointer-events-none absolute -left-40 top-10 w-[50rem] text-rose-gold/10"
      >
        <path
          d="M20 300C160 80 300 40 380 140s-60 220 60 160 140-260 340-200"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
      </svg>
      <Reveal name="signature_studio">
        <div className="relative grid items-start gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <StudioDemo families={families} />
          <div className="lg:pt-8">
            <Eyebrow dark>SIGNATURE STUDIO</Eyebrow>
            <div className="mt-4">
              <Heading
                id="studio-heading"
                dark
                sub="Go beyond ordinary typed signatures. Create a signature that feels personal with beautiful calligraphy, natural cursive lettering, elegant curves, and customizable flourishes."
              >
                Your Signature. <span className="italic text-rose-gold">Your Style.</span>
              </Heading>
            </div>
            <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {families.map((f) => (
                <li key={f.id} className="rounded-xl border border-white/15 bg-white/5 p-3">
                  <span
                    className="block truncate text-2xl leading-tight text-white"
                    style={{ fontFamily: f.family, fontSize: `${1.5 * f.scale}rem` }}
                  >
                    Signature
                  </span>
                  <span className="mt-1 block text-xs font-semibold text-white/80">{f.label}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <CheckList
                dark
                columns
                items={[
                  'Typed signatures',
                  'Hand-drawn signatures',
                  'Uploaded signatures',
                  'Cursive styles',
                  'Calligraphy',
                  'Initials',
                  { label: 'More signature families', soon: true },
                  { label: 'Letter slant', soon: true },
                  { label: 'Curves, loops and flourishes', soon: true },
                  { label: 'Underlines', soon: true },
                  { label: 'Ink stroke weight', soon: true },
                  { label: 'Saved signatures', soon: true },
                ]}
              />
            </div>
            <Cta href={startHref} dark>
              Create Your Signature
            </Cta>
            <p className="mt-4 text-sm text-white/70">
              You create your signature when you sign a document you were sent, or when you sign
              your own.
            </p>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

const FLOW: { name: string; detail: string; status: Status; icon: typeof CheckCircle2 }[] = [
  { name: 'You (sender)', detail: 'Sent the document', status: 'completed', icon: Send },
  { name: 'Signer 1 · Avery Lane', detail: 'Signed', status: 'completed', icon: CheckCircle2 },
  { name: 'Signer 2 · Sam Ortiz', detail: 'Their turn now', status: 'pending', icon: Clock },
  {
    name: 'Approver · Riley Chen',
    detail: 'Waiting for signer 2',
    status: 'not_started',
    icon: CircleDashed,
  },
];

export function SigningWorkflowVisual() {
  return (
    <figure className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-white p-5 shadow-card">
        <p className="text-sm font-semibold text-heading">In order: one after another</p>
        <ol className="mt-4 flex flex-col gap-3">
          {FLOW.map((f, i) => (
            <li key={f.name} className="relative flex items-center gap-3">
              {i < FLOW.length - 1 ? (
                <span className="absolute left-5 top-10 h-4 w-px bg-border" aria-hidden />
              ) : null}
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-surface text-primary">
                <f.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-heading">{f.name}</span>
                <span className="block text-xs">{f.detail}</span>
              </span>
              <StatusPill status={f.status} />
            </li>
          ))}
          <li className="flex items-center gap-3 rounded-xl bg-success-bg/60 p-2">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success text-white">
              <CheckCircle2 className="size-5" aria-hidden />
            </span>
            <span className="text-sm font-semibold text-heading">
              Completed document and evidence certificate
            </span>
          </li>
        </ol>
      </div>
      <div className="rounded-2xl border border-border bg-white p-5 shadow-card">
        <p className="text-sm font-semibold text-heading">
          At the same time: everyone signs in parallel
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {(
            [
              ['Morgan Blake', 'completed', UserRound],
              ['Kai Patel', 'pending', UserRound],
              ['Jamie Fox', 'declined', XCircle],
            ] as const
          ).map(([name, status, Icon]) => (
            <li
              key={name}
              className="flex flex-col items-start gap-2 rounded-xl border border-border p-3"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-heading">
                <Icon className="size-4 text-primary" aria-hidden /> {name}
              </span>
              <StatusPill status={status} />
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="text-xs">
        Product demonstration · fictional data. Green means completed, amber pending, red declined
        and grey not started; every status also has a text label.
      </figcaption>
    </figure>
  );
}

export function SigningWorkflowsSpotlight() {
  return (
    <FeatureSpotlight
      id="workflows"
      name="signing_workflows"
      tone="blush"
      reverse
      eyebrow="SIGNING WORKFLOWS"
      title="Collect Signatures Without the Back-and-Forth."
      sub="Send an agreement to one signer or to several participants. Choose who signs first, who approves, and who only receives a copy, then watch each person's status update."
      visual={<SigningWorkflowVisual />}
    >
      <CheckList
        columns
        items={[
          'Multiple signers',
          'Signing order',
          'Parallel signing',
          'Sequential signing',
          'Approval workflows',
          'Recipient roles: signer, approver, reviewer, copy',
          'Secure invitations with optional email codes',
          'Expiration settings',
          'Decline with a reason',
          'Completion notifications',
          { label: 'Automatic reminders', soon: true },
        ]}
      />
      <Cta href="/developers#endpoints" event="api_docs_clicked">
        Explore Signing Workflows
      </Cta>
    </FeatureSpotlight>
  );
}

export function DocumentManagementSpotlight({ documentsHref }: { documentsHref: string }) {
  return (
    <FeatureSpotlight
      id="documents"
      name="document_management"
      tone="white"
      eyebrow="TRACK AND MANAGE"
      title="Know Exactly Where Every Agreement Stands."
      sub="One documents list shows every agreement, who still needs to act, and what happened along the way. Completed copies and evidence certificates are a click away."
      visual={<DocumentsMock />}
    >
      <CheckList
        columns
        items={[
          'Search by title, signer or reference',
          'Filter by status, type and owner',
          'Sort by date',
          'View signing progress',
          'Download completed PDFs',
          'View activity history',
          'Retrieve evidence certificates',
          'Document versions',
          'Access by permission',
          'Archive and retention settings',
          { label: 'Reminders from the dashboard', soon: true },
          { label: 'Tags and folders', soon: true },
        ]}
      />
      <Cta href={documentsHref}>Manage Your Documents</Cta>
    </FeatureSpotlight>
  );
}

export function TemplateShowcase({ templatesHref }: { templatesHref: string }) {
  return (
    <FeatureSpotlight
      id="templates"
      name="templates"
      tone="light"
      reverse
      eyebrow="TEMPLATES"
      title="Create Once. Reuse Whenever You Need."
      sub="Turn frequently used agreements into reusable templates with saved recipient roles and signature fields."
      visual={<TemplatesMock />}
    >
      <CheckList
        columns
        items={[
          'Create templates',
          'Edit templates',
          'Duplicate templates',
          'Assign categories',
          'Save signer placeholders',
          'Reuse field placements',
          'Draft and published versions',
          'Share with your workspace',
        ]}
      />
      <p className="mt-6 text-sm">
        Examples: Service Agreement, NDA, Employment Offer, Contractor Agreement, Artist Agreement
        and Vendor Agreement.
      </p>
      <Cta href={templatesHref}>Explore Templates</Cta>
    </FeatureSpotlight>
  );
}

export function TeamShowcase({ teamHref }: { teamHref: string }) {
  return (
    <FeatureSpotlight
      id="business"
      name="teams"
      tone="blush"
      eyebrow="FOR BUSINESS"
      title="Built for Individuals. Ready for Teams."
      sub="Start on your own and invite your team when you are ready. Workspaces keep documents, templates, people and billing together, with the right access for each person."
      visual={<TeamMock />}
    >
      <CheckList
        columns
        items={[
          'Organization workspaces',
          'Team invitations',
          'Roles and permissions',
          'Shared templates',
          'Group management',
          'Workspace branding',
          'Document ownership',
          'Controlled document access',
          'Centralized billing',
          'Dashboard and reports by sender, type and month',
        ]}
      />
      <Cta href={teamHref}>Explore Business Features</Cta>
    </FeatureSpotlight>
  );
}
