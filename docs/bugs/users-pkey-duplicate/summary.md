# Bug: INSERT into iam.users violates `users_pkey`

## Summary

`identity-service` fails with:

```
insert into "iam"."users" (...) values (...) - duplicate key value violates unique constraint "users_pkey"
```

The service tries to **INSERT a user whose `id` already exists** in `iam.users`.
Because `users_pkey` is a *global* unique constraint on `id` (not composite with
`tenant_id`), the second insert is rejected.

## Root cause (one sentence)

`UserRepository.save()` decided create-vs-update with a check that, under the
newly RLS-enforced runtime role, never saw the existing row — so every save of an
already-persisted user fell into the INSERT branch and collided with the primary
key.

See `root-cause.md` for the full chain.