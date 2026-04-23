---
title: Data Retention
description: What artifact.ci stores and for how long.
---

artifact.ci is intended only as a temporary storage for the sake of viewing artifacts — the source of truth is GitHub. So, when you view an artifact, it is pulled from GitHub and uploaded to our storage service (Supabase).

Stored files will be periodically deleted from the storage service. Old artifacts can still be viewed, but they will need to be pulled from GitHub and uploaded again (this process is automatic, it usually just means waiting a few seconds to view your artifact again).

This cleanup happens regularly, but no files newer than 24 hours old will be cleaned up. If you need a retention policy shorter than 24 hours, please get in touch.

Metadata is stored in the database, and is *not* deleted automatically. This metadata includes:

- Repository name and owner
- Commit SHAs
- Branch names
- GitHub Actions run ids
- Artifact names
- Artifact file *names* (content is not stored in the database / not retained)

This metadata is used to identify and retrieve artifacts that do not (yet) exist in the storage service.

If you want to delete this metadata, you can email contact@artifact.ci.
