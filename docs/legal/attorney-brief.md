# Brief for legal review

Signature Tender needs attorney review before it accepts real customer documents (spec Part 26 and the
release checklist). This brief lists what to review and where each item lives. Nothing here has been
reviewed by counsel yet, and the product must not say otherwise.

## What the product does today

- Senders upload a PDF, add recipients, place fields, and send. Recipients get an emailed link. They
  can be required to enter a one-time code sent to the same email.
- Before signing, recipients see an electronic records disclosure and must agree. They then adopt a
  typed, drawn or uploaded signature and confirm their intent to sign.
- When everyone has signed, the system produces a signed PDF and a completion certificate. These are
  backed by an evidence log that records each step with time, IP address and user agent.
  Recipients get a link to the completed copy.
- The certificate separates Signature Tender's own evidence from identity verification. We do not
  verify government identity.
- Real sending is switched off. Only test requests, clearly marked TEST, can be sent.

## Items for review

| #   | Item                                                                                                                                            | Where it lives                                                                                                                                  | Status                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Electronic records and signature disclosure (consumer consent, hardware and software, paper copies, withdrawal)                                 | Configuration `legal.esign_disclosure` (database, versioned); shown at `/sign/...` and `/legal/esign-disclosure`                                | Draft, marked "pending attorney review"                              |
| 2   | Specialized and excluded documents (wills, family law, court documents, certain notices, notarized and recorded instruments, regulated records) | Configuration `legal.specialized_documents`; senders must confirm before a real send, and the confirmation and version go into the evidence log | Draft list; needs jurisdiction review and wording                    |
| 3   | Terms of Service, including liability allocation                                                                                                | `/legal/terms`                                                                                                                                  | Placeholder only                                                     |
| 4   | Privacy Policy and data processing (including Resend, Stripe, Vercel, Neon as processors)                                                       | `/legal/privacy`                                                                                                                                | Placeholder only                                                     |
| 5   | Record retention (default about 7 years, minimum 1 year, deleted drafts 30 days)                                                                | Configuration `retention.*`; workspace setting                                                                                                  | Defaults pending review; deletion feature flag is off                |
| 6   | Completion certificate contents and wording                                                                                                     | Generated PDF (see a test certificate from staging)                                                                                             | Needs review                                                         |
| 7   | Cancellation and credit policy                                                                                                                  | Configuration `billing.cancel_credit_policy`                                                                                                    | Needs review with Terms                                              |
| 8   | Marketing claims                                                                                                                                | Public pages                                                                                                                                    | Qualified wording only: no "legally binding" or certification claims |
| 9   | International use                                                                                                                               | Not restricted in the product                                                                                                                   | Decide whether to limit to the U.S. at launch                        |
| 10  | Consent re-presentation when the disclosure changes                                                                                             | New version recorded per request; earlier requests keep the version they were sent with                                                         | Confirm the approach                                                 |

## How changes are made

Legal text is stored as versioned configuration in the database, not in code, so approved wording can
be loaded without a release. Each signing request keeps the disclosure version it was sent with.

## What we need back

- Approved text for items 1 to 4, or edits.
- Decisions on items 2, 5, 7, 9 and 10.
- Confirmation of which claims the public site may make.
