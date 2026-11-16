/**
 * Content for the comparison and solution landing pages.
 *
 * Copy rules: describe Signature Tender only as it works today, describe other products only in
 * general terms that hold across their plans (no competitor prices, which change often), say where
 * the other product is the better fit, and keep legal statements qualified. Prices for Signature
 * Tender are filled in from the database at render time through the {price} and {studioPrice}
 * placeholders.
 */

export type Faq = { q: string; a: string };

export type Competitor = {
  slug: string;
  /** Product name as its owner writes it. */
  name: string;
  /** Short name used in running text. */
  short: string;
  owner: string;
  pricingUrl: string;
  metaTitle: string;
  metaDescription: string;
  h1: string;
  intro: string;
  /** Where the other product is the stronger choice. */
  theyFit: string[];
  /** Where Signature Tender is the stronger choice. */
  weFit: string[];
  rows: { label: string; us: string; them: string }[];
  faq: Faq[];
};

const SHARED_ROWS = (them: string) => [
  {
    label: 'Recipients need an account',
    us: 'No. Recipients sign from a secure email link.',
    them: `No. ${them} recipients can sign without an account.`,
  },
  { label: 'Recipients pay to sign', us: 'Never.', them: 'No.' },
  {
    label: 'Signing on phone, tablet or computer',
    us: 'Yes, in the browser.',
    them: 'Yes.',
  },
  {
    label: 'Audit trail and completion certificate',
    us: 'Yes. Every completed PDF comes with an evidence certificate and a SHA-256 fingerprint.',
    them: 'Yes.',
  },
  {
    label: 'Reusable templates',
    us: 'Yes, with recipient roles and fields.',
    them: 'Yes.',
  },
  {
    label: 'Signing order and multiple signers',
    us: 'Yes. Up to {maxSigners} signers per request, in order or at the same time.',
    them: 'Yes.',
  },
  {
    label: 'Email verification code before signing',
    us: 'Yes, optional per recipient.',
    them: 'Yes, on supported plans.',
  },
  {
    label: 'REST API and webhooks',
    us: 'Yes.',
    them: 'Yes.',
  },
];

export const COMPETITORS: Competitor[] = [
  {
    slug: 'docusign-alternative',
    name: 'Docusign eSignature',
    short: 'Docusign',
    owner: 'Docusign, Inc.',
    pricingUrl: 'https://ecom.docusign.com/plans-and-pricing/esignature',
    metaTitle: 'Docusign Alternative With No Subscription | Signature Tender',
    metaDescription:
      'Looking for a Docusign alternative? Signature Tender lets you send documents for e-signature and pay per document, with no monthly plan. Compare features.',
    h1: 'A Docusign Alternative That Charges Per Document, Not Per Month',
    intro:
      'Docusign is the best-known name in electronic signatures, and it is built for organizations that send agreements every day. If you only need a signature now and then, a subscription can mean paying for months you do not use. Signature Tender gives you the core of e-signing (upload a PDF, add signers, place fields, track and download the signed copy) for {price} per document, with no plan to cancel.',
    theyFit: [
      'You send a high volume of agreements every month across many users.',
      'You need enterprise tools such as contract lifecycle management, SSO and advanced admin controls.',
      'You rely on its large catalogue of prebuilt integrations.',
    ],
    weFit: [
      'You send a few documents a month, or only a few a year.',
      'You want to pay for what you send, with no auto-renewing plan.',
      'You want a simple workflow: upload, add signers, send, done.',
      'You want a custom handwritten signature from Signature Studio.',
    ],
    rows: [
      {
        label: 'How you pay',
        us: '{price} per signing request, prepaid credit packs, or an optional monthly plan.',
        them: 'Mainly monthly or annual subscription plans, with send limits on some plans.',
      },
      {
        label: 'Monthly commitment',
        us: 'None.',
        them: 'Subscription required to send.',
      },
      ...SHARED_ROWS('Docusign'),
      {
        label: 'Custom handwritten signature designer',
        us: 'Yes. Signature Studio, {studioPrice} per design.',
        them: 'Typed, drawn or uploaded signatures.',
      },
      {
        label: 'Enterprise suite (CLM, SSO, advanced admin)',
        us: 'Not offered. Signature Tender focuses on sending and signing.',
        them: 'Available on enterprise plans.',
      },
    ],
    faq: [
      {
        q: 'Is Signature Tender a good Docusign alternative for occasional senders?',
        a: 'Yes, that is who it is built for. You pay {price} per signing request instead of a monthly plan, and one request covers one document, up to {maxSigners} signers, email invitations and reminders, and the completed PDF with its evidence certificate.',
      },
      {
        q: 'Can I move my Docusign templates to Signature Tender?',
        a: 'There is no automatic import. Upload the same PDF, place the fields and recipient roles once, and save it as a template to reuse.',
      },
      {
        q: 'Do my signers need to do anything different?',
        a: 'No. They receive an email, open a secure link, review the document and sign on any device. They do not need an account and never pay.',
      },
      {
        q: 'Are signatures made with Signature Tender legally recognized?',
        a: 'Many jurisdictions, including the United States under the ESIGN Act and UETA, recognize electronic signatures, but validity depends on the applicable law, the type of document and how it was signed. Signature Tender records evidence of each signing but does not give legal advice.',
      },
    ],
  },
  {
    slug: 'adobe-sign-alternative',
    name: 'Adobe Acrobat Sign',
    short: 'Adobe Acrobat Sign',
    owner: 'Adobe Inc.',
    pricingUrl: 'https://www.adobe.com/acrobat/pricing/business.html',
    metaTitle: 'Adobe Acrobat Sign Alternative, Pay Per Document | Signature Tender',
    metaDescription:
      'Need an Adobe Sign alternative without an Acrobat subscription? Send PDFs for e-signature with Signature Tender and pay only when you send. See how they compare.',
    h1: 'An Adobe Acrobat Sign Alternative Without the Acrobat Subscription',
    intro:
      'Adobe Acrobat Sign comes with Adobe’s Acrobat plans, which makes sense if you already edit PDFs in Acrobat every day. If all you need is to get a PDF signed, Signature Tender does that one job well: upload, add signers, place fields and send, for {price} per document with no subscription.',
    theyFit: [
      'You already pay for Acrobat and edit, convert or combine PDFs regularly.',
      'Your company standardizes on Adobe tools and Microsoft or Salesforce integrations.',
      'You need enterprise administration and compliance features across a large team.',
    ],
    weFit: [
      'You just need documents signed, not a full PDF editor.',
      'You prefer paying per document over a monthly or annual plan.',
      'You want a short, guided flow that first-time senders can follow.',
      'You want a custom handwritten signature from Signature Studio.',
    ],
    rows: [
      {
        label: 'How you pay',
        us: '{price} per signing request, prepaid credit packs, or an optional monthly plan.',
        them: 'Included with Acrobat subscription plans, billed monthly or annually.',
      },
      {
        label: 'Monthly commitment',
        us: 'None.',
        them: 'Subscription required to send.',
      },
      ...SHARED_ROWS('Adobe Acrobat Sign'),
      {
        label: 'PDF editing, conversion and OCR',
        us: 'Not offered. Upload a finished PDF.',
        them: 'Yes, through Acrobat.',
      },
      {
        label: 'Custom handwritten signature designer',
        us: 'Yes. Signature Studio, {studioPrice} per design.',
        them: 'Typed, drawn or uploaded signatures.',
      },
    ],
    faq: [
      {
        q: 'Do I need Adobe Acrobat to use Signature Tender?',
        a: 'No. You only need a PDF and a web browser. Signers do not need any software or account.',
      },
      {
        q: 'How much does it cost to send one PDF for signature?',
        a: '{price} per signing request, in USD. Credit packs lower the price per request, and monthly plans are optional for frequent senders.',
      },
      {
        q: 'Can several people sign the same PDF?',
        a: 'Yes. One request includes up to {maxSigners} signers, who can sign in a set order or at the same time. You can also add approvers and people who only receive a copy.',
      },
      {
        q: 'Are signatures made with Signature Tender legally recognized?',
        a: 'Many jurisdictions, including the United States under the ESIGN Act and UETA, recognize electronic signatures, but validity depends on the applicable law, the type of document and how it was signed. Signature Tender records evidence of each signing but does not give legal advice.',
      },
    ],
  },
  {
    slug: 'dropbox-sign-alternative',
    name: 'Dropbox Sign',
    short: 'Dropbox Sign',
    owner: 'Dropbox, Inc.',
    pricingUrl: 'https://sign.dropbox.com/products/dropbox-sign/pricing',
    metaTitle: 'Dropbox Sign (HelloSign) Alternative, No Subscription | Signature Tender',
    metaDescription:
      'Compare Signature Tender with Dropbox Sign, formerly HelloSign. Send documents for e-signature and pay per document instead of a monthly plan.',
    h1: 'A Dropbox Sign Alternative for People Who Send Now and Then',
    intro:
      'Dropbox Sign, formerly HelloSign, is a clean e-signature tool that fits well if your files already live in Dropbox. Its plans are subscriptions. Signature Tender is pay per document: {price} to send one request, with credit packs and optional plans if you send more.',
    theyFit: [
      'Your team stores and shares documents in Dropbox.',
      'You send enough each month that a flat subscription works out cheaper.',
      'You need its specific integrations or embedded signing at scale.',
    ],
    weFit: [
      'You send occasionally and do not want another subscription.',
      'You want every completed PDF to come with an evidence certificate you can verify online.',
      'You want a custom handwritten signature from Signature Studio.',
    ],
    rows: [
      {
        label: 'How you pay',
        us: '{price} per signing request, prepaid credit packs, or an optional monthly plan.',
        them: 'Monthly or annual subscription plans.',
      },
      {
        label: 'Monthly commitment',
        us: 'None.',
        them: 'Subscription required for regular sending.',
      },
      ...SHARED_ROWS('Dropbox Sign'),
      {
        label: 'Public certificate verification page',
        us: 'Yes. Anyone can check a certificate reference at signaturetender.com/verify.',
        them: 'Audit trail included with documents.',
      },
      {
        label: 'Custom handwritten signature designer',
        us: 'Yes. Signature Studio, {studioPrice} per design.',
        them: 'Typed, drawn or uploaded signatures.',
      },
    ],
    faq: [
      {
        q: 'Is HelloSign the same as Dropbox Sign?',
        a: 'Yes. HelloSign was renamed Dropbox Sign after Dropbox acquired it.',
      },
      {
        q: 'Why choose pay-per-document e-signatures?',
        a: 'If you send a handful of documents a year, paying {price} each usually costs less than a subscription, and there is nothing to remember to cancel.',
      },
      {
        q: 'Do recipients need a Signature Tender account?',
        a: 'No. Recipients sign from a personal link in their email and never pay. You can require a one-time email code before they open the document.',
      },
    ],
  },
];

export type Solution = {
  slug: string;
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  h1: string;
  intro: string;
  points: { title: string; body: string }[];
  steps: [string, string][];
  faq: Faq[];
  /** Keywords a reader might search for, shown nowhere: used to pick related links. */
  related: string[];
};

const STEPS_SEND: [string, string][] = [
  ['Upload your PDF', 'Add the document you need signed.'],
  [
    'Add signers and fields',
    'Enter each signer’s email and drag signature, date and text fields onto the page.',
  ],
  [
    'Pay and send',
    'Pay {price} for the request or use a credit. Signers get a secure link by email.',
  ],
  [
    'Download the signed PDF',
    'When everyone has signed, download the completed PDF and its evidence certificate.',
  ],
];

export const SOLUTIONS: Solution[] = [
  {
    slug: 'sign-pdf-online',
    metaTitle: 'Sign a PDF Online and Send It for Signature | Signature Tender',
    metaDescription:
      'Sign PDF documents online and collect signatures from others. Upload a PDF, place signature fields, send a secure link and download the signed copy.',
    eyebrow: 'SIGN PDF ONLINE',
    h1: 'Sign PDF Documents Online, and Get Others to Sign Too',
    intro:
      'Upload any PDF, place signature, initials, date and text fields, and send it to the people who need to sign. You can sign it yourself as well. Everyone signs in the browser, with no software to install.',
    points: [
      { title: 'No downloads', body: 'Works in any modern browser on phone, tablet or computer.' },
      {
        title: 'Type, draw or upload',
        body: 'Signers choose how to sign: type their name in a handwriting style, draw it, or upload an image.',
      },
      {
        title: 'Signed copy with evidence',
        body: 'The finished PDF comes with a certificate listing each signer, the time and the document fingerprint.',
      },
      {
        title: 'Private by design',
        body: 'Files are stored privately and links are personal to each recipient.',
      },
    ],
    steps: STEPS_SEND,
    faq: [
      {
        q: 'How do I sign a PDF online?',
        a: 'Upload the PDF to Signature Tender, add yourself and anyone else as signers, place the fields, and send. Each signer opens a secure link, clicks the fields and signs.',
      },
      {
        q: 'Can I sign a PDF on my phone?',
        a: 'Yes. The signing page works in mobile browsers, and you can draw your signature with your finger.',
      },
      { q: 'What does it cost?', a: '{price} per signing request. Recipients never pay.' },
    ],
    related: ['e-signature-without-subscription', 'electronic-signature-for-small-business'],
  },
  {
    slug: 'e-signature-without-subscription',
    metaTitle: 'E-Signature Without a Subscription: Pay Per Document | Signature Tender',
    metaDescription:
      'Get documents e-signed without a monthly plan. Pay per signing request, buy credits that do not expire at launch, and upgrade only if you send often.',
    eyebrow: 'PAY AS YOU GO',
    h1: 'Electronic Signatures Without a Subscription',
    intro:
      'Most e-signature tools ask for a monthly plan before you can send anything. Signature Tender lets you pay for one document at a time: {price} per signing request. If you send more, credit packs lower the price, and monthly plans are there only if you want one.',
    points: [
      {
        title: 'Pay per document',
        body: '{price} covers one document, up to {maxSigners} signers, reminders and the completed PDF with its certificate.',
      },
      {
        title: 'Credit packs',
        body: 'Buy several requests at once for a lower price each. Prepaid credits do not expire at launch, subject to final terms.',
      },
      {
        title: 'Optional plans',
        body: 'Monthly plans are for frequent senders and are never started automatically.',
      },
      {
        title: 'Recipients sign free',
        body: 'The people you send to never need an account and never pay.',
      },
    ],
    steps: STEPS_SEND,
    faq: [
      {
        q: 'Is there a free trial?',
        a: 'Creating an account is free. You pay when you send a document for signature.',
      },
      {
        q: 'Will I be charged every month?',
        a: 'No. Without a plan you are only charged when you buy a request or a credit pack.',
      },
      {
        q: 'Is pay per document cheaper than a subscription?',
        a: 'For people who send a few documents a month or less, usually yes. Compare your expected volume with our pricing page.',
      },
    ],
    related: ['sign-pdf-online', 'electronic-signature-for-freelancers'],
  },
  {
    slug: 'electronic-signature-for-small-business',
    metaTitle: 'Electronic Signature Software for Small Business | Signature Tender',
    metaDescription:
      'Affordable e-signature software for small businesses. Send contracts and forms for signature, reuse templates, invite your team and pay per document.',
    eyebrow: 'SMALL BUSINESS',
    h1: 'Affordable Electronic Signatures for Small Businesses',
    intro:
      'Get customer agreements, vendor forms and contracts signed without adding another expensive subscription. Your whole team can work from one workspace with shared templates and one billing account.',
    points: [
      {
        title: 'Team workspace',
        body: 'Invite teammates with roles and permissions, share templates and keep one billing account.',
      },
      {
        title: 'Templates',
        body: 'Save documents with their fields and roles, then send them again in seconds.',
      },
      { title: 'Your branding', body: 'Add your logo and colours to the signing experience.' },
      {
        title: 'Track every document',
        body: 'See who has opened, signed or declined, with a full activity history.',
      },
    ],
    steps: STEPS_SEND,
    faq: [
      {
        q: 'Can several people in my business send documents?',
        a: 'Yes. Invite teammates to your workspace and choose what each role can do.',
      },
      {
        q: 'Can we connect Signature Tender to other apps?',
        a: 'Yes. The REST API and signed webhooks let you send documents and receive status updates from your own systems. Slack and other connections are available in the app.',
      },
      {
        q: 'What does it cost a business?',
        a: '{price} per signing request, with credit packs and optional monthly plans for higher volume.',
      },
    ],
    related: ['hr-onboarding-e-signature', 'real-estate-e-signature'],
  },
  {
    slug: 'real-estate-e-signature',
    metaTitle: 'E-Signatures for Real Estate Agents and Landlords | Signature Tender',
    metaDescription:
      'Send leases, rental applications and disclosures for e-signature. Collect signatures from several tenants or buyers in order, from any device.',
    eyebrow: 'REAL ESTATE',
    h1: 'E-Signatures for Leases, Agreements and Property Paperwork',
    intro:
      'Landlords, property managers and agents juggle documents that several people must sign. Signature Tender sends one secure link to each person, in the order you choose, and gives you a signed copy with an evidence certificate.',
    points: [
      {
        title: 'Multiple signers',
        body: 'Up to {maxSigners} signers per request, such as co-tenants, guarantors and the landlord.',
      },
      { title: 'Signing order', body: 'Send to everyone at once or one after another.' },
      {
        title: 'Sign from anywhere',
        body: 'Tenants and buyers sign on their phone without an app or account.',
      },
      {
        title: 'Lease templates',
        body: 'Save your standard lease with fields in place and reuse it for every unit.',
      },
    ],
    steps: STEPS_SEND,
    faq: [
      {
        q: 'Can I send a lease to several tenants?',
        a: 'Yes. Add each tenant as a signer. They can sign in order or at the same time, and everyone gets the completed copy.',
      },
      {
        q: 'Do tenants need to create an account?',
        a: 'No. They sign from a secure link in their email and never pay.',
      },
      {
        q: 'Are e-signed leases valid?',
        a: 'Many jurisdictions accept electronic signatures on leases, but rules vary by location and document type. Check local requirements for documents such as deeds, which may need other formalities.',
      },
    ],
    related: ['electronic-signature-for-small-business', 'sign-pdf-online'],
  },
  {
    slug: 'hr-onboarding-e-signature',
    metaTitle: 'E-Signatures for HR: Offer Letters and Onboarding | Signature Tender',
    metaDescription:
      'Send offer letters, policies and onboarding forms for electronic signature. Reuse templates, track who has signed and keep signed copies with certificates.',
    eyebrow: 'HR AND ONBOARDING',
    h1: 'E-Signatures for Offer Letters and Employee Onboarding',
    intro:
      'Send offer letters, handbooks acknowledgements and onboarding forms to new hires in minutes. Templates keep every document consistent, and the dashboard shows who still needs to sign.',
    points: [
      {
        title: 'Offer letter templates',
        body: 'Save your offer letter with fields for the candidate and the hiring manager.',
      },
      { title: 'Reminders', body: 'Email reminders go out to people who have not signed yet.' },
      { title: 'Status at a glance', body: 'See which documents are waiting, signed or declined.' },
      {
        title: 'Signed records',
        body: 'Download each signed PDF with its evidence certificate for your files.',
      },
    ],
    steps: STEPS_SEND,
    faq: [
      {
        q: 'Can a new hire sign before they have a company email?',
        a: 'Yes. Send to any email address. They do not need an account.',
      },
      {
        q: 'Can both the candidate and the manager sign?',
        a: 'Yes. Add both as signers and choose the order.',
      },
      {
        q: 'Can I require identity checks?',
        a: 'You can require a one-time code sent to the signer’s email before they open the document.',
      },
    ],
    related: ['electronic-signature-for-small-business', 'e-signature-without-subscription'],
  },
  {
    slug: 'electronic-signature-for-freelancers',
    metaTitle: 'E-Signatures for Freelancers and Consultants | Signature Tender',
    metaDescription:
      'Send proposals, contracts and statements of work for e-signature. No subscription: freelancers pay per document and clients sign free from any device.',
    eyebrow: 'FREELANCERS',
    h1: 'Get Client Contracts Signed Without a Monthly Plan',
    intro:
      'When you send a contract or statement of work a few times a month, a subscription is money spent on nothing. Signature Tender charges {price} per signing request, and your clients sign free from their phone or computer.',
    points: [
      {
        title: 'Look professional',
        body: 'Clients get a clean signing page with your workspace branding.',
      },
      {
        title: 'Know when they sign',
        body: 'See when a client opens and signs, and get the completed PDF straight away.',
      },
      {
        title: 'Reusable contracts',
        body: 'Save your standard agreement as a template and send it in seconds.',
      },
      {
        title: 'A signature that is yours',
        body: 'Design a custom handwritten signature in Signature Studio for {studioPrice}.',
      },
    ],
    steps: STEPS_SEND,
    faq: [
      {
        q: 'How much does it cost to send a contract?',
        a: '{price} per signing request, which includes up to {maxSigners} signers.',
      },
      {
        q: 'Can I sign the contract myself too?',
        a: 'Yes. Add yourself as a signer along with your client.',
      },
      { q: 'Do clients pay anything?', a: 'No. Recipients never pay and do not need an account.' },
    ],
    related: ['e-signature-without-subscription', 'sign-pdf-online'],
  },
];

export const competitorBySlug = (slug: string) => COMPETITORS.find((c) => c.slug === slug);
export const solutionBySlug = (slug: string) => SOLUTIONS.find((s) => s.slug === slug);

export type PriceVars = { price: string; studioPrice: string; maxSigners: number };

/** Fills {price}, {studioPrice} and {maxSigners} with the live values. */
export function fill(text: string, v: PriceVars): string {
  return text
    .replaceAll('{price}', v.price)
    .replaceAll('{studioPrice}', v.studioPrice)
    .replaceAll('{maxSigners}', String(v.maxSigners));
}

/** Short labels for links to each solution page. */
export const SOLUTION_LINKS: Record<string, string> = {
  'sign-pdf-online': 'Sign PDFs online',
  'e-signature-without-subscription': 'E-signatures without a subscription',
  'electronic-signature-for-small-business': 'For small businesses',
  'real-estate-e-signature': 'For real estate',
  'hr-onboarding-e-signature': 'For HR and onboarding',
  'electronic-signature-for-freelancers': 'For freelancers',
};
