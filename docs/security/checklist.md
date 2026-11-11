# Security review checklist (per pull request)

- [ ] Every new tenant table has `workspace_id`, RLS enabled and forced, and policies for each operation
- [ ] New queries on tenant data go through `withActor()`
- [ ] Service functions validate input with Zod and check permissions before writing
- [ ] State changes write an audit event in the same transaction
- [ ] No prices, limits, legal text or credentials hardcoded
- [ ] No claims of legal validity, certification or compliance in UI copy
- [ ] Tests cover the permission-denied path and a cross-tenant attempt
- [ ] Dependencies added are maintained and permissively licensed
- [ ] Destructive migrations (drop, rename, type narrowing) have explicit approval
