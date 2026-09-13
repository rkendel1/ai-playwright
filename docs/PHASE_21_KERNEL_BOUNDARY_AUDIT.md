# Phase 21: Kernel Boundary & Public Contract Audit

## Context

Phase 20 proved:
- Artifact Kernel is **production-proven** (real examples, real data flow)
- Artifact lifecycle is **architecturally coherent** (source → pipeline → artifact → transform → materialization)
- Local durability works (JSON, versioning, identity)
- Composition works (multi-input derivation)
- Artifact Engine is not a general system; it's a specialized kernel with a clear outer boundary

Phase 20 also left **two architectural questions open:**
1. **Authorization/ExecutionEvidence boundary:** Are these kernel-owned or external concerns?
2. **Composition semantics:** How is composition provenance distinct from transformation lineage?

This phase resolves those ambiguities so we know exactly where the kernel stops and integration/productization begins.

## The Critical Distinction

The types exist in the codebase:
- `CapabilityPolicy`
- `AuthorizationDecision`
- `ExecutionEvidence`
- `TransformationRecord` (single-input lineage)
- `CompositionInputs` (multi-input provenance)

But they're not clearly positioned. Phase 21 answers:
- Are these **kernel contracts** (owning their semantics)?
- Or **supporting primitives** (applications use them externally)?

The answer determines what Phase 22+ builds.

## Four Questions Phase 21 Must Answer

### Question 1: Does Authorization Belong to the Artifact Kernel?

**Current evidence:**
- Kernel has `CapabilityPolicy` and `AuthorizationDecision` types
- These are NOT exercised in the primary production lifecycle (Phase 20 audit)
- Authorization decisions are made *outside* the kernel (e.g., "user can read artifact")
- Kernel does not enforce these decisions

**Investigation required:**
- Is authorization semantically part of artifact identity/integrity?
- Or is it a consumer-side concern (applications decide what users can do)?
- Do artifacts need to carry authorization metadata as part of their contract?
- Or do applications implement authorization in their own layer?

**Possible outcomes:**
- ✅ Authorization is kernel-owned: Refactor kernel to enforce it (Phase 22+)
- ✅ Authorization is external: Make that boundary explicit, remove from kernel contract
- ✅ Hybrid: Kernel carries optional metadata, consumers enforce policy

**Do NOT assume:** Just because types exist means they belong in the kernel contract.

---

### Question 2: What Is the Precise Semantic Difference Between Transformation Lineage and Composition Provenance?

**Current evidence:**
- Transformation: `A --[transform]--> B` (single input, single output, TransformationRecord)
- Composition: `A --|
       |--[compose]--> C` (multiple inputs, single output, CompositionInputs)

**Investigation required:**
- Is composition a special case of transformation (multiple parents)?
- Or are they fundamentally different operations?
- Does composition need its own lineage abstraction?
- Should multi-parent graphs use TransformationRecord or a different model?

**Key question:**
Transformation changes one artifact into another.
Composition derives a new artifact from an explicitly ordered set of existing artifacts.
Is this semantic distinction worth encoding, or is it an implementation detail?

**Possible outcomes:**
- ✅ Keep separate: Composition is NOT a multi-parent transformation
- ✅ Unify: Composition IS a transformation with multiple inputs (extend TransformationRecord)
- ✅ Clarify: Document why they're different without changing types

**Do NOT assume:** Graphs should be uniform (multi-parent as a generalization of single-parent).

---

### Question 3: Which Current Types Are Public Kernel Contracts vs. Supporting/Internal APIs?

**Types in scope:**
- `Artifact` (identity, versions, materialization)
- `ArtifactVersion` (content, hash, timestamp)
- `TransformationRecord` (lineage, input identity)
- `Pipeline` (transformation source, configuration)
- `CapabilityPolicy`
- `AuthorizationDecision`
- `ExecutionEvidence`
- `CompositionInputs`

**Investigation required:**
- Which of these are part of "the artifact contract" that external systems depend on?
- Which are internal implementation details?
- Which should consumers be allowed to extend?
- Which should be sealed/immutable?

**Example distinction:**
- PUBLIC: `Artifact.id`, `Artifact.versions`, `ArtifactVersion.content`
- INTERNAL: `_lastPolledTimestamp`, `_cacheKey`, `_transactionLog`
- CONSUMER-EXTENSIBLE: `ExecutionEvidence.customMetadata`?
- SEALED: `ArtifactVersion.hash` (computed, not user-supplied)

**Do NOT assume:** All types are equally part of the public contract.

---

### Question 4: What Does an External Application Actually Need to Integrate With the Kernel Without Duplicating Its Semantics?

**Integration scenarios:**
1. **Registry:** Application stores artifacts. Needs: artifact identity + versioning contract
2. **Trust system:** Application attests artifacts. Needs: lineage + authorization boundary
3. **Consumer policy:** Application decides what's readable/executable. Needs: what metadata?
4. **Deployment:** Application materializes artifacts. Needs: how much lineage history?

**Investigation required:**
- Can an application use the kernel's artifact identity without implementing authorization?
- Can an application use composition without understanding transformation semantics?
- Does the kernel's lineage model support all consumer use cases?
- What's the minimal contract an application needs?

**Possible gap examples:**
- If authorization IS kernel-owned, applications need enforcement hooks
- If lineage IS complex, applications need query/traverse APIs
- If composition semantics are unclear, applications may misuse it
- If persistence contract is vague, applications may cache incorrectly

**Do NOT assume:** The current API surface is sufficient for all consumers.

---

## Phase 21 Deliverables

### 1. Kernel Boundary Document
- Explicit list of what's inside the kernel (owns semantics, enforces invariants)
- Explicit list of what's outside (consumer responsibility)
- Rationale for each boundary decision

**Example:**
```
INSIDE KERNEL:
- Artifact identity & versioning (owns uniqueness, versioning invariants)
- Transformation record (owns lineage semantics)
- Materialization (owns artifact content + hash)

OUTSIDE KERNEL:
- Authorization enforcement (consumers decide policy)
- Registry/storage (kernel doesn't know where artifacts live)
- Trust claims/attestations (kernel doesn't assert them)
- Revocation (consumers implement if needed)
```

### 2. Public Contract Specification
- Which types are consumers allowed to depend on?
- Which are subject to change?
- Which require kernel-enforced invariants?
- Which are free-form extensible?

**Example:**
```
PUBLIC (Stable):
- Artifact.id (immutable, unique, stable identity)
- Artifact.versions (append-only, version history)
- ArtifactVersion.hash (immutable, derived)

INTERNAL (May Change):
- _cacheKey, _timestamp, _pollingState

CONSUMER-EXTENSIBLE (Contract: no breaking semantics):
- ExecutionEvidence.customMetadata (free-form JSON)
- Pipeline.metadata (configuration-specific)

SEALED (Never User-Supplied):
- ArtifactVersion.hash, Artifact.createdAt
```

### 3. Authorization Position Paper
- Does authorization belong in the kernel contract?
- If yes: how should it be enforced?
- If no: what should consumers implement?
- What metadata should artifacts carry for authorization decisions?

**Example structure:**
```
FINDING: Authorization is a consumer concern, not kernel-owned.

RATIONALE:
- Kernel has no mechanism to enforce policy
- Different applications have different authorization models
- Authorization is orthogonal to artifact identity/lineage

RECOMMENDATION:
- Remove CapabilityPolicy from kernel contract
- Provide optional ExecutionEvidence.authorization metadata
- Document that consumers implement their own policy enforcement
- Suggest reference implementation for common cases
```

### 4. Composition Semantics Clarification
- What is composition semantically?
- Is it different from multi-parent transformation, or equivalent?
- Should the kernel distinguish them, or are they the same concept?
- What's the lineage model for composed artifacts?

**Example:**
```
FINDING: Composition IS a transformation with multiple inputs.

SEMANTIC MODEL:
- Transformation: f(A) → B (single input, deterministic function)
- Composition: g(A, B, C) → D (multiple inputs, deterministic function)
- Both are transformations; composition is just n-ary instead of unary

LINEAGE REPRESENTATION:
- Transformation: {operation, inputs: [A.id], output: B.id}
- Composition: {operation, inputs: [A.id, B.id, C.id], output: D.id}
- Same structure; inputs is a list instead of single item

IMPLICATION:
- Consumers can use the same lineage traversal for both
- No need for separate CompositionInputs type
- TransformationRecord.inputs: ArtifactId[] (not just one)
```

### 5. API Surface Audit
- Which current types/methods should be public?
- Which should be internal?
- What's missing for consumer integration?
- What should be deprecated?

**Example:**
```
PUBLIC METHODS:
- Kernel.artifact(id) → Artifact
- Artifact.versions() → VersionHistory
- Artifact.lineage() → TransformationRecord[]
- Artifact.materialize(version) → Content

INTERNAL METHODS:
- Kernel._invalidateCache()
- Artifact._syncMetadata()
- TransformationRecord._normalize()

MISSING FOR CONSUMERS:
- Kernel.artifacts() or search API (needed for registry)
- Artifact.canRead(user) API (needed for authorization)
- Lineage.traverse() API (needed for composition tracking)
```

---

## Phase 21 Constraints

### Must NOT Build
- ❌ Authorization enforcement system (first answer if it belongs in kernel)
- ❌ Registry or storage abstraction (first understand what consumers need)
- ❌ Trust/attestation system (intentionally external)
- ❌ Revocation system (intentionally external)
- ❌ Policy engine (first determine if kernel owns policy)
- ❌ Distributed sync (first understand local semantics)
- ❌ Multi-parent lineage abstraction (first clarify composition semantics)
- ❌ New execution framework (use existing Phase 20 framework)
- ❌ New persistence layer (keep Phase 20 JSON-based durability)
- ❌ Adapter framework (only if kernel audit requires it)

### Must Answer (Not Speculate)
- ✅ Authorization boundary: kernel-owned or external?
- ✅ Composition semantics: distinct or equivalent to transformation?
- ✅ Public vs. internal: which types/methods are consumer-facing?
- ✅ Consumer needs: what minimal contract do applications require?

### May Clarify (Not Change)
- ✅ Document why types exist but aren't used (ExecutionEvidence, CapabilityPolicy, etc.)
- ✅ Document intended use cases for each type
- ✅ Suggest reference implementations for common patterns
- ✅ Deprecation notes if types don't belong in kernel

---

## Success Criteria

Phase 21 is done when:

1. **Kernel boundary is explicit**
   - Clear list of what's inside vs. outside
   - Rationale for each boundary decision
   - No ambiguity about where responsibility lies

2. **Public contract is clear**
   - Consumers know which types are stable
   - Consumers know which are subject to change
   - Consumers know what invariants kernel enforces

3. **Authorization position is decided**
   - Either: kernel enforces it (with mechanism)
   - Or: consumers implement it (with guidance)
   - Not: ambiguous whether kernel owns it

4. **Composition semantics are documented**
   - Either: distinct from transformation (with reason)
   - Or: equivalent to multi-input transformation (with model)
   - Not: unclear what composition is

5. **No architectural debt**
   - Types that don't belong in kernel are removed/deprecated
   - Types that do belong have clear semantics
   - APIs that confuse consumers are clarified

---

## Current Status (Phase 21 Baseline)

**Proven:**
- Artifact Kernel (production-proven, architecturally coherent)
- Artifact lifecycle (source → pipeline → artifact → transform → materialization)
- Local durability (JSON, versioning, identity)
- Composition (multi-input derivation)
- Materialization (artifact content + hash)

**Open:**
- Authorization boundary (kernel-owned or external?)
- Composition vs. transformation semantics (distinct or equivalent?)
- Public contract surface (which types are stable?)
- Consumer integration needs (what's the minimal contract?)

**Intentionally External:**
- Trust, claims, attestations (applications implement)
- Revocation (applications implement if needed)
- Registry/discovery (applications implement)
- Distributed sync (post-Phase-21 if needed)
- Deployment (applications implement)

---

## Why This Matters

Until Phase 21 closes the two open questions:
- We can't confidently build integration layers (Phase 22+)
- We can't know what consumers actually need
- We might build features that don't belong in the kernel
- We might leave the kernel incomplete for consumer use

Phase 21 is the **last architecture-only phase** before productization.

After Phase 21:
- The kernel is sealed (no more major changes)
- Consumer contract is clear (no more surprises)
- Integration is straightforward (known boundary)
- Productization can begin (Phase 22+)

---

## References

- Phase 20: Artifact Engine Lifecycle Verification (production-proven baseline)
- Kernel Boundary Architecture (this document defines the boundary)
- Public Contract Specification (consumer-facing API)
- Authorization Position Paper (decision on authorization ownership)
- Composition Semantics (decision on lineage model)

---

## Next Steps (Phase 22+)

Once Phase 21 settles the boundary questions:
- Phase 22: Integration layer (registry, discovery, consumer APIs)
- Phase 23: Trust system (if authorization is kernel-owned)
- Phase 24: Deployment (materialization at scale)
- Phase 25+: Productization (packaging, documentation, user experience)

But not before. Phase 21 is the gate.
