# EggDrop3D

EggDrop3D is a playful browser-based STEM lab for building an egg-drop contraption, releasing it from any height between 5 and 50 feet, and studying what happens. The editor includes 15 construction materials, snapped transforms, physical connectors, undo/redo, three constrained missions, deterministic shell-damage metrics, local drafts, and anonymous cloud share links.

The simulation is educational rather than engineering-grade. Soft materials are represented with calibrated compliance and damping; the results should be used to explore design tradeoffs, not to certify a real-world safety design.

## Architecture

- `apps/web` — React 19, Vite, Three.js, React Three Fiber, and Rapier. Rendering and the fixed 60 Hz physics loop stay entirely in the browser.
- `apps/api` — Hono Lambda API for explicit cloud saves, public reads, optimistic updates, deletes, edit-token hashing, payload validation, and per-IP rate limiting.
- `packages/shared` — versioned design/result contracts, Zod schemas, the 15-material catalog, mission inventories, scoring, units, snapping, drag, buoyancy, and damage helpers.
- `infra` — AWS CDK stack for a private S3 origin, CloudFront, a private Node.js 24 ARM64 Lambda Function URL, and retained on-demand DynamoDB storage.
- `deploy.sh` — build-once CDK deployment and cache-aware S3 publishing flow.

CloudFront signs both origins with Origin Access Control. API writes include the SHA-256 hash of the exact request body, and edit authorization uses `X-Edit-Token` because CloudFront replaces the viewer `Authorization` header with its SigV4 signature.

## Local development

Requirements:

- Node.js 22 or newer and npm
- A current browser with WebGL for the interactive 3D scene

Install and start both the in-memory API and the Vite app:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api/*` to the in-memory API on port `8787`, so local saves and share-link flows can be exercised without AWS. The local API is intentionally ephemeral and resets when its process restarts.

Useful commands:

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run synth
```

Keyboard controls in build mode include <kbd>Ctrl/Cmd-Z</kbd> for undo, <kbd>Ctrl/Cmd-Shift-Z</kbd> for redo, <kbd>Ctrl/Cmd-D</kbd> for duplicate, <kbd>Delete</kbd> for delete, <kbd>W</kbd>/<kbd>E</kbd>/<kbd>R</kbd> for translate/rotate/scale, and <kbd>Escape</kbd> to cancel the active material or connector.

## Saves and sharing

The active draft autosaves only to that browser. AWS writes happen only when **Save** or **Update** is clicked. **Share** copies a public `/design/:id` URL only after the latest changes have been saved.

Creating a cloud design returns a one-time 256-bit edit token. Only its hash is stored in DynamoDB; the raw token and the “My designs” index remain in that browser's local storage and never appear in a share URL. A browser with the token can update or delete the design. Everyone else can view, drop, and create an unowned local remix. Lost edit tokens cannot be recovered.

Shared records are public and retained until their owner deletes them. There is deliberately no public listing endpoint, account system, leaderboard, collaborative editing, or server-side physics in version 1.

## AWS deployment

Before the first deployment:

1. Configure AWS CLI credentials (`aws sts get-caller-identity` must succeed).
2. Bootstrap the target account/region once, for example `npx cdk bootstrap aws://ACCOUNT_ID/us-east-1`.
3. Install dependencies with `npm install`.

Then run:

```bash
./deploy.sh
```

Defaults are `AWS_REGION=us-east-1` and `STACK_NAME=EggDrop3DStack`. Both are overridable:

```bash
AWS_REGION=us-west-2 STACK_NAME=MyEggDropStack ./deploy.sh
```

The script verifies tooling and credentials, builds shared code/Lambda/web exactly once, deploys CDK, uploads hashed assets with one-year immutable caching, uploads entry files with revalidation, invalidates `/` and `/index.html`, and prints the CloudFront URL. It never prints edit tokens or AWS credentials.

Creating this repository and script does not deploy anything. Run `./deploy.sh` only when you intend to create or update AWS resources. S3 and DynamoDB use retain policies, so deleting the CloudFormation stack does not automatically delete user designs or uploaded content.

## API

- `POST /api/designs` — create a design; returns its public ID and one-time edit token.
- `GET /api/designs/:id` — public read-only design, with ETag support.
- `PUT /api/designs/:id` — update with `X-Edit-Token` and `If-Match`.
- `DELETE /api/designs/:id` — delete with `X-Edit-Token` and `If-Match`.

The API rejects unknown materials, non-finite transforms, invalid joint references, mission overages, more than 100 parts or 200 joints, and payloads over 250 KiB. Reads are limited to 120/minute/IP and writes to 30/minute/IP.
