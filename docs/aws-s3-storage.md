# Private AWS S3 project-chat storage

## Application configuration

For hybrid production routing, set `PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER=vercel-blob` and `PROJECT_CHAT_VIDEO_STORAGE_PROVIDER=aws-s3`. Set either target to `local` for local testing. Validated video extensions use the video target; all other allowed files use the default target, and each upload is sent to exactly one provider. `PROJECT_CHAT_STORAGE_PROVIDER` is a deprecated fallback: an explicit category variable wins, otherwise the legacy value applies, the video target then falls back to the resolved default, and finally local is the development default.

When either target is S3, also set `AWS_REGION` and `AWS_S3_BUCKET_NAME`. `PROJECT_CHAT_S3_PREFIX` defaults to `project-chat`, and `AWS_S3_PRESIGNED_URL_EXPIRATION_SECONDS` defaults to 600 (allowed range: 60-3600). `AWS_S3_ENDPOINT` and `AWS_S3_FORCE_PATH_STYLE` are only for a compatible custom endpoint. Vercel credentials are required only when a target uses `vercel-blob`; local/local requires neither cloud provider.

On AWS, prefer an IAM role and omit static credentials so the SDK default credential chain is used. On Vercel, add `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as encrypted server-side Environment Variables for the appropriate environments; never prefix them with `NEXT_PUBLIC_`, paste them into source control, or expose them to the browser. Redeploy after changing environment variables.

S3 video uploads remain private and use collision-resistant keys under `project-chat/` (or the configured prefix). The application authorizes the user and project, creates a short-lived pending upload row, returns a presigned S3 PUT URL to the browser, and records the attachment only after confirming the object with `HeadObject`. Downloads are authorized by the application before it returns a short-lived presigned GET redirect. Deletion accepts only database-loaded keys inside that prefix. The application does not need `ListBucket`, public ACLs, CloudFront, Lambda, or any other AWS service.

## Existing attachment migration

The provider-identity migration backfills historical attachments from the metadata contract that existed before S3 support: `/uploads/project-chat/...` URLs are local and HTTP(S) URLs are Vercel Blob. Their existing `fileName` becomes the stable `storageKey`. Historical rows are never assigned to AWS. The migration deliberately aborts on any other URL or empty key rather than guessing.

Before deployment, audit production with:

```sql
SELECT "id", "fileName", "url"
FROM "ProjectCommentAttachment"
WHERE "fileName" = ''
   OR ("url" NOT LIKE '/uploads/project-chat/%' AND "url" !~ '^https?://');
```

Resolve every returned row before `prisma migrate deploy`. Retain the legacy `fileName` and `url` columns for API compatibility, but new reads and deletions use required `storageProvider` plus `storageKey`. A future migration may remove `url` only after clients no longer depend on that response field.

Application comment and project deletion clean remote objects before deleting database metadata. A remote failure retains metadata so cleanup can be retried. If remote cleanup succeeds but the subsequent database deletion fails, the row can temporarily reference a missing object; investigate the structured server error and retry the database operation.

## Manual AWS setup

Do these steps manually; the repository does not create or deploy AWS resources.

1. Create one general-purpose S3 bucket in the region used by the application. Use a unique bucket name.
2. Enable **Block all public access**, keep Object Ownership set to **Bucket owner enforced** (ACLs disabled), and enable default encryption (SSE-S3 is the simplest no-extra-key-cost choice).
3. Add CORS for the exact browser origins that will upload videos. Keep origins narrow; do not use `"*"` with authenticated app uploads. Include localhost only for a local live AWS test:

```json
[
  {
    "AllowedOrigins": [
      "https://YOUR_VERCEL_APP.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

4. Add a lifecycle expiration rule only if the product's retention policy permits automatic deletion. Direct uploads that complete in S3 but fail before comment persistence can leave unattached objects; until a cleanup job exists, periodically inspect and remove disposable test objects under the project-chat prefix.
5. Create an IAM role/user dedicated to this application. Replace both placeholders below and attach only this object policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ProjectChatObjectsOnly",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/YOUR_PROJECT_CHAT_PREFIX/*"
    }
  ]
}
```

No bucket listing permission is required. Keep the bucket policy private and restrict credentials to the deployment that needs them.

6. Configure the environment values from `.env.example`. For local testing, use a non-production bucket and narrowly scoped temporary credentials, run `npm run dev`, upload/download/delete a disposable attachment, then remove it. Automated storage tests use mocks: `npm run test:storage` does **not** verify live AWS access.
7. Before production, run `npm run validate:deploy-env`, `npm run test:storage`, `npm run lint`, `npm run typecheck`, and `npm run build`.

## Security notes

- Treat filenames and MIME headers as untrusted. The shared policy allows the application's existing document, image, video, archive, and text extensions, sanitizes stored names, and enforces 10 MB ordinary-file and 100 MB video limits.
- Presigned URLs are bearer credentials until expiration. Do not log or share them. A user can still download and copy a file while authorized.
- Direct upload rows are scoped to the authenticated user and project, expire quickly, and are consumed when the comment is created.
- Rotate static keys, use a dedicated IAM principal, and prefer short-lived role credentials where the host supports them.
- Keep versioning off unless recovery requirements justify its retained-version costs. If enabled, add an intentional noncurrent-version lifecycle policy.

## Cost controls (preferred $0; maximum $20/month)

S3 bills for stored GB-month, PUT/GET/DELETE request classes (DELETE is generally free), and some data transfer. Pricing varies by region and can change, so review the official S3 pricing page and AWS Pricing Calculator for the chosen region. Do not assume Free Tier eligibility: account age, offer terms, region, and usage determine eligibility.

The automated tests are designed to cost $0 because they mock AWS and never contact S3. The live verification upload is not guaranteed to be free: S3 can bill for storage, PUT/HEAD/GET requests, and client download egress. This implementation uploads and downloads directly between the browser and S3 after authorization, avoiding a second application-server transfer. Cross-region access can still cost more; keep the bucket near expected users/deployment when practical.

In AWS Billing, create an AWS Budget with actual and forecast email alerts at **$1**, **$5**, and **$15**. Also enable billing preferences/notifications and review Cost Explorer regularly. A budget alert only notifies - it does **not** automatically stop requests or cap charges. Avoid repeated downloads, verbose data-event logging, replication, Transfer Acceleration, unnecessary cross-region traffic, and unbounded object/version retention. Use lifecycle expiration only when it agrees with the application's retention requirements.

## Safe removal

1. Switch the application to another provider and deploy that configuration. Existing S3 attachment metadata is provider-dependent, so migrate or accept loss of access before switching.
2. Confirm retention/legal requirements, then manually empty current objects and any versions/delete markers under the project-chat prefix.
3. Remove the IAM policy/principal or role binding and delete Vercel/local credential variables.
4. Delete the bucket after it is empty, then remove related budget alerts if they are no longer useful. Check the next bill/Cost Explorer because final metered usage can appear later.
