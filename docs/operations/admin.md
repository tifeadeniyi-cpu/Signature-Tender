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

## Before production

- Require a passkey or two-factor sign-in for staff accounts.
- Review the `admin.viewed` audit rows regularly.
