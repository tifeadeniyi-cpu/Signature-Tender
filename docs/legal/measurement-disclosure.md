# Usage measurement: privacy notice draft (for legal review)

**Status: draft for counsel.** This text is not published anywhere yet. The Privacy Policy page
is still a placeholder (`/legal/privacy`), and this section should be reviewed and adapted by
counsel before it goes into the published policy.

## What changed in the product

Signature Tender now measures four things to understand how the service is used. All four are
designed so that no cookie, local storage, device fingerprint, IP address or advertising
identifier is stored or used.

| Measure              | What is stored                                                                                                         | What is never stored                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Website visits       | A daily count per page group (for example "Pricing") and per source category (for example "Search engines")            | IP address, user agent, cookies, the full referring address, search terms, campaign names, or anything that identifies a visitor |
| Sign-up source       | One coarse category per new account (direct, search, social, AI assistant, email, paid campaign, other website)        | The referring address, campaign values or the page history                                                                       |
| Time in the app      | Active seconds per signed-in person per day                                                                            | Which pages or documents were open, page-by-page history, mouse movements or keystrokes                                          |
| Subscription changes | Starts, renewals, failed renewal attempts, cancellation requests and ends, with the workspace and the Stripe reference | Card details (these stay with Stripe)                                                                                            |

How each is measured:

- **Visits** are counted in the browser when a public page loads from outside the site. Reloads
  and moves between pages don't count. The browser sends only the page group and the source
  category.
- **Sign-up source** is worked out in the browser during the visit and carried to the account
  in the post-sign-up link, then removed from the address bar. It is recorded only for accounts
  created in the last 7 days, once.
- **Time in the app** counts only while a signed-in tab is visible and focused and the person
  has clicked, typed or scrolled within the last minute. The server will not credit more time
  than has actually passed.
- **Subscription changes** are recorded from the billing events Stripe already sends us.

Opt-out: nothing in the first three rows is collected when the browser sends **Global Privacy
Control** or **Do Not Track**. Subscription changes are part of providing and billing the
service and are not optional.

Retention: per-person daily active time is deleted after 13 months. Visit counts contain no
personal data and are kept as aggregates. Sign-up source and active time are deleted with the
account.

Access: only Signature Tender staff with the analytics permission can see these measures, and
only as totals. Groups smaller than 5 are withheld or merged. Every staff view and export is
recorded in the audit log.

## Suggested policy text

> **How we measure use of Signature Tender.** We count visits to our website and record, in
> broad categories, where new accounts came from (for example "search engine" or "social
> media"). When you use the app while signed in, we record how many minutes per day you were
> actively using it. We use this only to understand and improve the service, as totals across
> all customers. We do not use cookies or device identifiers for this, we do not store your IP
> address for it, and we do not record which documents or pages you looked at. If your browser
> sends Global Privacy Control or Do Not Track, we don't collect any of it. Daily activity
> records are deleted after 13 months, or sooner if you close your account. We also record
> changes to your subscription (start, renewal, cancellation) as part of billing.

## Questions for counsel

1. **Legal basis.** Is legitimate interest appropriate for aggregate visit counts and per-account
   daily active time in each market we serve (including the EU/UK under GDPR and California
   under CCPA/CPRA)?
2. **Device access (ePrivacy / PECR).** The design reads the referring page and page-load type
   that the browser already provides and stores nothing on the device. Please confirm this does
   not need consent, or tell us if a consent prompt is still expected.
3. **Opt-out.** We honour Global Privacy Control and Do Not Track. Should there also be an
   account setting to switch off time-in-app measurement?
4. **Retention.** Is 13 months for per-person daily activity acceptable?
5. **Disclosure placement.** Should this sit in the Privacy Policy only, or also in a short notice
   inside the app?
