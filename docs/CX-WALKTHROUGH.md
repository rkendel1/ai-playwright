# Runora CX Walkthrough

This walkthrough follows the current shipped Runora product from a clean workspace to persisted history using the deterministic checkout fixture in this repository.

## Canonical flow

```text
Initialize
  ↓
Create and manage tests
  ↓
Describe behavior in plain English
  ↓
Run against a real browser
  ↓
Observe Runtime Truth
  ↓
PASS / FAIL
  ↓
Inspect evidence
  ↓
Diagnose failure
  ↓
Create heal candidate
  ↓
Accept verified fix
  ↓
Run the suite
  ↓
Review persistent history
```

## Screenshot set

These images come from the real Runora workspace UI, not mock HTML:

1. ![Test workspace](./images/01-test-workspace.png)
2. ![Test running](./images/02-test-running.png)
3. ![Runtime Truth](./images/03-runtime-truth.png)
4. ![Passing test](./images/04-passing-test.png)
5. ![Failure diagnosis](./images/05-failure-diagnosis.png)
6. ![Failure evidence](./images/06-failure-evidence.png)
7. ![Observation details](./images/07-observation-details.png)
8. ![Suggested Next Steps](./images/08-suggested-next-steps.png)
9. ![Heal candidate](./images/09-heal-candidate.png)
10. ![Suite run](./images/10-suite-run.png)
11. ![Suite history](./images/11-suite-history.png)
12. ![Test history](./images/12-test-history.png)

## What is intentionally not shown

The current product does **not** yet ship a dedicated UI for:

- Playwright code promotion
- post-promotion deterministic execution proof
- arbitrary step-level rerun
- side-by-side evidence comparison

Those states are therefore excluded from the screenshot set instead of being mocked.

## Reproduction

See [`docs/CX-SCREENSHOTS.md`](./CX-SCREENSHOTS.md) for the exact fixture, commands, and capture order used to regenerate the screenshots.
