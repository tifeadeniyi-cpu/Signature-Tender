# Staff administration

`/admin` is the internal area for Signature Tender staff. It is separate from every customer
workspace and answers 404 to anyone who is not on the staff list.

## What staff can see

- Overview: workspace, user and request counts, completions, pending and failed work, credits
  used, API calls and revenue (net of refunds).
- Workspaces: name, id, members, plan, request counts, last activity, credits and payment issues.
- Operations: finishing failures, failed webhook deliveries (destination host only), payment
  issues, unprocessed Stripe events, paid requests not dispatched, and feature flags (read-only).

Staff never see document files, signing evidence or recipient emails through this area. Every
page view is written to the audit log as `admin.viewed`.

## Granting and removing staff

Staff are granted by hand with the database owner role. The app's own role cannot read or
change the list.

```sql
-- Grant (the person must already have a verified account)
insert into platform_admins (user_id, note)
select id, 'Operations, granted by <name>' from "user" where email = '<their email>';

-- Remove
delete from platform_admins
where user_id = (select id from "user" where email = '<their email>');
```

Run these against the right branch in Neon (SQL editor, as the owner). Keep the list short.

## Sign-in requirement

Staff must have two-factor sign-in or a passkey on their account. Without one, opening `/admin` sends
them to Sign-in and security with an explanation.

## Regularly

- Review the `admin.viewed` audit rows.
- Keep the staff list short and remove people who no longer need it.

## Complimentary (founder) workspaces

A workspace on the complimentary list signs for free with no limit: sending never needs a credit,
nothing is reserved or charged, and checkout is refused. The founder workspace (Lara's Workspace,
`71eabc8e-2b94-4757-b0a5-8f6da7082c4d`) is on it. Every other workspace pays as normal.

The list is the `billing.complimentary_workspaces` row in `app_config`, a JSON array of workspace
ids. Only the database owner can change it.

```sql
-- Add a workspace
insert into app_config (key, value, description)
values ('billing.complimentary_workspaces', '["<workspace id>"]',
        'Workspaces that sign for free with no limit (founder)')
on conflict (key) do update
  set value = app_config.value || jsonb_build_array('<workspace id>'::text), updated_at = now();

-- Remove a workspace (normal billing resumes on its next send)
update app_config set value = value - '<workspace id>', updated_at = now()
where key = 'billing.complimentary_workspaces';
```

This does not switch on real signing. Live sending still waits for the `production_signing` flag
and the release checklist.
