# Runora CX Screenshot Capture

This repository includes a reproducible screenshot harness for the README walkthrough.

## Fixture

- Fixture app: `tests/fixtures/cxApp.ts`
- Workspace acceptance test: `tests/e2e/cx-workspace.e2e.ts`
- Screenshot output directory: `docs/images/`
- Viewport: `1440x1600`
- Planner used for stable captures: `deterministic`
- Browser runtime: `obscura`

## What the harness proves

The capture flow uses the real Runora UI and runner to verify:

- workspace initialization
- test creation
- single-test PASS
- single-test FAIL
- Runtime Truth
- failure evidence
- observation expansion
- Suggested Next Steps
- heal candidate creation
- suite execution
- suite history persistence
- test history persistence

## Startup and capture commands

From the repository root:

```bash
npm install
AIPW_UPDATE_CX_SCREENSHOTS=1 npm test -- tests/e2e/cx-workspace.e2e.ts
```

The harness starts its own deterministic fixture app and its own Runora UI server. It writes fresh screenshots into `docs/images/`.

## Capture order

The test currently captures these files in order:

1. `01-test-workspace.png`
2. `02-test-running.png`
3. `03-runtime-truth.png`
4. `04-passing-test.png`
5. `05-failure-diagnosis.png`
6. `06-failure-evidence.png`
7. `07-observation-details.png`
8. `08-suggested-next-steps.png`
9. `09-heal-candidate.png`
10. `10-suite-run.png`
11. `11-suite-history.png`
12. `12-test-history.png`

## Failure trigger used for captures

The fixture includes an `Invalid Payment` journey that deterministically fails and produces preserved Runtime Truth plus screenshot evidence. The harness uses that flow for the failure, evidence, suggestion, and heal-candidate captures.

## Regeneration notes

- Do not hand-edit screenshots.
- Do not replace them with mock UI.
- If the product UI changes, re-run the harness and update README copy to match the shipped behavior.
- Omitted states are intentional: if a UI flow is not shipped, it should not appear in the screenshot set.
