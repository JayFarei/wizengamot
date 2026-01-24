# Knowledge Graph Curation Guide

A practical guide to knowledge graph curation techniques, synthesizing academic research (Huaman & Fensel 2021) with operational insights from memory-centric systems.

## Overview

### What is Knowledge Graph Curation?

Knowledge graph curation is the systematic process of assessing, cleaning, and enriching knowledge graphs to ensure data quality and operational fitness. Unlike one-time data cleaning, curation is an **iterative and continuous process** that maintains KG quality throughout its lifecycle.

Curation can be understood through two complementary lenses:

- **Quality-centric view**: Ensuring conformance across multiple dimensions (accuracy, consistency, completeness, provenance) via verification and validation workflows
- **Fitness-centric view**: Optimizing for downstream utility, where "fitness" measures how much a record improves task outcomes relative to its cost (storage, latency) and risk (staleness, conflicts)

The synthesis: **fitness aggregates quality dimensions into operational decisions**, while quality dimensions provide the stable, auditable vocabulary for measuring and governing fitness.

### Why Curation Matters

The quality of applications built on knowledge graphs directly depends on the quality of the underlying data. Poor quality KGs lead to:
- Incorrect query results
- Unreliable reasoning and inference
- Degraded machine learning model performance
- Loss of user trust
- Retrieval failures in RAG systems

**The fundamental principle**: Application quality ≤ Knowledge Graph quality

### The Core Tasks

1. **Assessment** - Measuring quality across multiple dimensions and computing fitness scores
2. **Cleaning** - Detecting and correcting errors through verification, validation, and quarantine
3. **Enrichment** - Detecting duplicates, fusing knowledge, and enhancing connectivity
4. **Lifecycle Management** - Managing decay, stratification, and record states over time
5. **Provenance Tracking** - Maintaining audit trails for all changes and operations

## The Curation Framework

### Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    KNOWLEDGE GRAPH                          │
│                  (mapped and indexed)                       │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │   EVENT     │ │  SCHEDULED  │ │ CONTINUOUS  │
    │  TRIGGERS   │ │   AUDITS    │ │  MONITORING │
    └─────────────┘ └─────────────┘ └─────────────┘
            │               │               │
            └───────────────┼───────────────┘
                            ▼
              ┌─────────────────────────┐
              │       ASSESSMENT        │
              │   Quality + Fitness     │
              └─────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │        CLEANING         │
              │ Verify/Validate/Repair  │
              └─────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │       ENRICHMENT        │
              │  Consolidate/Connect    │
              └─────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │   LIFECYCLE MANAGEMENT  │
              │  Promote/Demote/Archive │
              └─────────────────────────┘
                            │
                            ▼
                    ┌───────────┐
                    │  Quality  │──── No ───┐
                    │ Achieved? │            │
                    └───────────┘            │
                            │               │
                           Yes              │
                            │               │
                            ▼               │
              ┌─────────────────────────┐   │
              │    CURATED KG OUTPUT    │   │
              └─────────────────────────┘   │
                                            │
                    ┌───────────────────────┘
                    │
                    ▼
              (Iterate back to Assessment)
```

### Curation Triggers

Curation can be initiated through multiple mechanisms:

| Trigger Type | Examples | Best For |
|--------------|----------|----------|
| **Event-driven** | New data ingestion, schema changes, constraint violations | Structural changes, immediate issues |
| **Scheduled** | Weekly quality audits, monthly re-validation, decay sweeps | Systemic drift, comprehensive checks |
| **Continuous** | Outcome monitoring, contradiction detection, usage patterns | Behavioral quality, adaptive maintenance |
| **Outcome-based** | Answer quality drops, retrieval failures, user corrections | Silent failures, utility degradation |

A robust curation system combines all trigger types:
- **Structural telemetry**: Validation signals from constraint checks
- **Behavioral telemetry**: Outcome signals from retrieval and task performance

### Who Performs Curation

| Curator Type | Strengths | Best For |
|--------------|-----------|----------|
| **Automated agents** | Speed, consistency, scale | Syntactic validation, duplicate detection, metrics calculation |
| **Human curators** | Judgment, domain expertise | Edge cases, ontology evolution, high-impact decisions |
| **Hybrid workflows** | Balances both | Automation by default, escalation by exception |

**Escalation criteria**: Route to human review when:
- High entropy or disagreement in automated decisions
- High downstream impact (core entities, sensitive facts)
- Repeated user corrections or task failures
- Novel patterns outside training distribution

### Input Requirements

Before curation begins, the knowledge graph should be:
- **Mapped** - Data sources integrated into a unified schema
- **Indexed** - Optimized for efficient querying
- **Versioned** - Changes tracked with provenance

## Quality Assessment

### The 20 Quality Dimensions

Quality assessment evaluates the KG across multiple dimensions, each with measurable metrics.

#### Accessibility Dimensions

| Dimension | Description | Example Metric |
|-----------|-------------|----------------|
| **Accessibility** | Data can be accessed by consumers | API availability, authentication success rate |
| **Interlinking** | Links to external KGs exist | % of entities with owl:sameAs links |
| **License** | Clear usage rights declared | Presence of dcterms:license |
| **Security** | Appropriate access controls | Authentication mechanisms in place |

#### Intrinsic Quality Dimensions

| Dimension | Description | Example Metric |
|-----------|-------------|----------------|
| **Accuracy** | Data correctly represents real-world | % of facts verified against trusted sources |
| **Consistency** | No logical contradictions | SHACL constraint violations count |
| **Trustworthiness** | Provenance is reliable | % of facts with source attribution |

#### Contextual Dimensions

| Dimension | Description | Example Metric |
|-----------|-------------|----------------|
| **Completeness** | Coverage of domain | % of expected properties populated |
| **Timeliness** | Data is current | Average age of facts, update frequency |
| **Relevancy** | Data serves intended purpose | User satisfaction surveys |
| **Amount of Data** | Sufficient volume | Triple count, entity count |

#### Representational Dimensions

| Dimension | Description | Example Metric |
|-----------|-------------|----------------|
| **Conciseness** | Minimal redundancy | Duplicate entity ratio |
| **Interpretability** | Human-understandable | % of entities with labels/descriptions |
| **Representational Consistency** | Uniform formatting | Schema adherence rate |
| **Versatility** | Supports multiple use cases | Query coverage for known use cases |

#### Syntactic Dimensions

| Dimension | Description | Example Metric |
|-----------|-------------|----------------|
| **Syntactic Validity** | Correct RDF/OWL syntax | Parser error rate |

#### Semantic Dimensions

| Dimension | Description | Example Metric |
|-----------|-------------|----------------|
| **Semantic Accuracy** | Correct ontology usage | Class/property misuse rate |
| **Understandability** | Clear meaning | Documentation coverage |

#### Pragmatic Dimensions

| Dimension | Description | Example Metric |
|-----------|-------------|----------------|
| **Ease of Operations** | Simple to use | Query complexity for common tasks |

#### Dynamic Dimensions

| Dimension | Description | Example Metric |
|-----------|-------------|----------------|
| **Currency** | Reflects latest known state | Time since last verification |

### Fitness Scoring

Beyond individual dimensions, compute a composite **fitness score** for operational decisions:

```
Fitness = f(validity, veracity, utility)

Where:
- Validity: Structural conformance (SHACL checks, schema compliance)
- Veracity: Epistemic confidence (provenance strength, corroboration)
- Utility: Behavioral lift (retrieval success, task performance)
```

#### Scoring Approaches

| Approach | Pros | Cons | Best For |
|----------|------|------|----------|
| **Continuous (0-1)** | Fine-grained, supports aggregation | Harder to interpret | Internal operations |
| **Discrete grades (A/B/C)** | Clear thresholds, explainable | Loses nuance | Reporting, governance |
| **Pass/warn/fail** | Simple, actionable | Binary thinking | Critical constraints |

**Recommendation**: Use continuous scores internally, derive discrete bands for user-facing displays and policy gates.

#### Fitness Components

| Component | Signals | Weight Factors |
|-----------|---------|----------------|
| **Structural validity** | SHACL/SPARQL checks pass | Non-negotiable floor |
| **Provenance confidence** | Source trust, citation count, corroboration | Modulates risk |
| **Behavioral utility** | Retrieval frequency, task success rate | Drives priority |
| **Temporal freshness** | Recency, last-validated timestamp | Domain-dependent |

### Temporal Quality Factors

Time affects quality through multiple mechanisms:

| Factor | Description | Handling |
|--------|-------------|----------|
| **Recency** | How recently the fact was observed/validated | Track assertion_time, source_time |
| **Validity interval** | Period during which the fact holds | Model start_date, end_date |
| **Staleness** | Time since last verification | Schedule re-validation based on SLAs |
| **Decay** | Gradual reduction in retrieval priority | Apply decay functions (exponential, power-law) |
| **Drift** | Contradiction with newer evidence | Flag for reconciliation |

**Key insight**: Decay salience and retrieval priority, not raw truth. Keep data recoverable while excluding stale items from default reasoning.

### Quality Thresholds and Trade-offs

Define "good enough" via policy tiers:

| Tier | Use Case | Acceptance Criteria |
|------|----------|---------------------|
| **Exploration** | Internal research, hypothesis generation | Minimal constraints, high recall |
| **Internal** | Team dashboards, analysis | Moderate accuracy, some gaps acceptable |
| **External** | User-facing, decision support | Strict accuracy, provenance required |
| **Critical** | Compliance, safety-critical | Full validation, human review |

**Stopping criteria**: Stop curation when marginal improvements no longer change task outcomes or error rates. Measure cleaning ROI continuously.

### Weighting Quality Dimensions

Not all dimensions are equally important for every application:

- **Question answering systems** may prioritize accuracy and completeness
- **Recommendation engines** may prioritize relevancy and timeliness
- **Enterprise systems** may prioritize security and trustworthiness

Define quality thresholds based on your application requirements before beginning curation.

## Cleaning

Cleaning involves detecting and correcting errors through multiple complementary approaches.

### Verification

Verification detects errors using **explicit specifications** of what the data should look like.

#### Query-Based Approaches

**SPARQL Queries**
- Write queries that return violations
- Example: Find entities with invalid date formats
```sparql
SELECT ?entity ?date
WHERE {
  ?entity schema:birthDate ?date .
  FILTER(!REGEX(?date, "^\\d{4}-\\d{2}-\\d{2}$"))
}
```

**SHACL (Shapes Constraint Language)**
- Declarative constraints on graph structure
- Validates cardinality, datatypes, patterns, relationships
```turtle
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [
    sh:path ex:birthDate ;
    sh:datatype xsd:date ;
    sh:maxCount 1 ;
  ] .
```

**ShEx (Shape Expressions)**
- Alternative to SHACL with different expressivity
- More compact syntax for some constraint types
```shex
ex:Person {
  ex:name xsd:string ;
  ex:birthDate xsd:date ? ;
  ex:knows @ex:Person *
}
```

#### Inference-Based Approaches

- Use ontology reasoning to detect inconsistencies
- OWL reasoners (HermiT, Pellet, ELK) can identify:
  - Unsatisfiable classes
  - Contradictory property assertions
  - Violated domain/range constraints
  - Impossible temporal sequences

#### When to Use Verification

- You have explicit schema or ontology constraints
- Errors are structural or syntactic in nature
- High-volume automated checking is needed

### Validation

Validation detects errors by checking facts against **evidence**, either internal or external.

#### Internal Validation

Using evidence within the knowledge graph itself:

- **Path-based validation**: Check if supporting paths exist for a claimed relationship
- **Type consistency**: Verify entity types align with property usage
- **Temporal consistency**: Check that dates and events form coherent timelines
- **Contradiction detection**: Find assertions that conflict with existing high-confidence facts

#### External Validation

Using evidence from outside sources:

- **Wikipedia/Wikidata**: Cross-reference facts against community-curated sources
- **Web corroboration**: Search for supporting evidence across web pages
- **Authoritative sources**: Validate against domain-specific trusted databases

#### Validation Strategies

| Strategy | Pros | Cons |
|----------|------|------|
| Manual review | High accuracy | Expensive, slow |
| Crowdsourcing | Scalable, diverse perspectives | Quality control challenges |
| Automated ML | Fast, consistent | May miss nuanced errors |
| Hybrid | Balances cost/quality | Complex to orchestrate |

### Quarantine

Instead of immediate deletion, isolate suspect records for review:

```
Record Lifecycle States:
active → flagged → quarantined → rehabilitated → archived → deleted
                              ↓
                         (or) corrected → active
```

#### Quarantine Triggers

| Trigger | Response |
|---------|----------|
| SHACL constraint violation | Auto-quarantine, log violation type |
| Evidence failure | Flag for re-validation |
| Contradiction with trusted source | Move to contested space |
| Repeated user corrections | Escalate for review |
| Security/policy concern | Immediate quarantine, separate sandbox |

#### Quarantine Operations

- **Demotion**: Reduce fitness score so record is less likely to be retrieved
- **Isolation**: Move to separate named graph excluded from default queries
- **Decay acceleration**: Apply faster decay function to fade unless rehabilitated
- **Review queue**: Route to human curator with context and evidence

**Key principle**: Quarantine shouldn't mean "forgotten." Monitor, sample, and use quarantined items for improving detectors and extractors.

### Repair and Self-Healing

Systems can automatically repair certain classes of errors:

#### Safe Repairs (Automated)

| Repair Type | Example | Risk Level |
|-------------|---------|------------|
| **Normalization** | Date formats, units, casing | Low |
| **Type coercion** | String to integer, URI cleanup | Low |
| **Canonicalization** | Identifier formats, encoding | Low |
| **Link repair** | Update broken URIs via redirects | Medium |

#### Risky Repairs (Require Validation)

| Repair Type | Example | Safeguards |
|-------------|---------|------------|
| **Backfilling** | Pull missing values from trusted sources | Provenance required |
| **Regeneration** | Re-extract from source documents | Version comparison |
| **Inference completion** | Derive missing relations via rules | Confidence thresholds |
| **Conflict resolution** | Choose between contradicting values | Trust scoring, human review |

#### Self-Healing Governance

- All repairs must be **reversible** with audit trails
- Semantic repairs require **validation** (constraint satisfaction + sampling)
- Track **repair traces** to learn which operators reduce future errors
- Don't force merges; keep competing hypotheses until evidence crosses threshold

### Cleaning Actions

Once errors are detected, possible actions include:

1. **Repair** - Automatically correct if safe
2. **Flag** - Mark for human review
3. **Quarantine** - Isolate from active use
4. **Demote** - Lower fitness/retrieval priority
5. **Delete** - Remove (rare, requires policy justification)

## Enrichment

Enrichment improves the KG by detecting duplicates, consolidating knowledge, and enhancing connectivity.

### Duplicate Detection (Instance Matching)

Identifies when multiple entities refer to the same real-world thing.

#### Matching Tiers

| Tier | Method | Confidence |
|------|--------|------------|
| **Exact** | Identical identifiers, functional properties | High |
| **Fuzzy** | String similarity (Levenshtein, Jaccard), normalized attributes | Medium |
| **Semantic** | Embedding similarity, shared neighbors, compatible types | Variable |

#### Matching Approaches

**Exact Matching**
- Identical identifiers or canonical names
- Fast but misses variations

**Similarity-Based Matching**
- String similarity (Levenshtein, Jaccard, Jaro-Winkler)
- Semantic similarity (embeddings, word vectors)
- Configurable thresholds

**Rule-Based Matching**
- Domain-specific rules combining multiple signals
- Example: Same name + same birth year + overlapping career = match

**Machine Learning**
- Train classifiers on labeled match/non-match pairs
- Can capture complex matching patterns

#### Soft Linking Before Hard Merging

Instead of immediate merges, use weighted equivalence links:

```
:entity1 :possibleSameAs :entity2 ;
         :matchConfidence 0.85 ;
         :matchEvidence "name_similarity, type_match" .
```

Promote to hard merge (`owl:sameAs`) only after:
- Repeated co-activation in retrieval
- Corroborating evidence accumulates
- No conflicting critical attributes
- Human review for high-impact entities

### Knowledge Fusion

After identifying duplicates, merge information from multiple representations.

#### Fusion Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| **Voting** | Most common value wins | High-redundancy sources |
| **Recency** | Most recent value wins | Time-sensitive facts |
| **Source trust** | Highest-trust source wins | Known source quality |
| **Specificity** | Most specific value wins | Hierarchical data |
| **Conflict flagging** | Keep all, mark conflicts | Human review needed |

#### Merge Decision Matrix

| Condition | Action |
|-----------|--------|
| Same scope, high confidence, no conflicts | Merge |
| Same scope, conflicts exist | Resolve via trust/recency, or keep both with context |
| Different scopes (time/jurisdiction) | Link, don't merge |
| Different types or granularity | Keep separate |
| Uncertain evidence | Soft link, wait for reinforcement |

#### Handling Conflicts

When sources disagree:

1. **Assess confidence**: Use source trust scores and evidence strength
2. **Consider context**: Some conflicts reflect legitimate variation (e.g., different name spellings)
3. **Preserve provenance**: Track which source each value came from
4. **Enable overrides**: Allow manual correction of fusion decisions
5. **Keep alternatives**: Use contextualized claims (named graphs, reification) rather than forcing resolution

### Consolidation

Consolidation transforms heterogeneous, redundant data into coherent, queryable structures.

#### Consolidation Operations

| Operation | Description | Example |
|-----------|-------------|---------|
| **Generalization** | Lift patterns to ontology constructs | Repeated "works_at" → define Employment class |
| **Abstraction** | Compress detail into summaries | Many events → EventSummary node |
| **Atomization** | Split compound assertions | Complex sentence → individual triples with provenance |
| **Normalization** | Standardize predicates, units, types | Various date formats → xsd:date |
| **Schema alignment** | Map heterogeneous schemas | source1:author ≡ source2:creator |

#### Layered Representation

Maintain multiple layers for different needs:

| Layer | Contents | Use Case |
|-------|----------|----------|
| **Atomic** | Granular triples with full provenance | Audit, precise queries |
| **Consolidated** | Merged entities, normalized relations | Standard retrieval |
| **Abstracted** | Summaries, topic nodes, hubs | Fast exploration |

Keep explicit trace links between layers for auditability.

#### Consolidation Triggers

- Repeated retrieval of same cluster
- Dense co-activation patterns
- High conflict rates (need reconciliation)
- Storage/performance optimization needs

### Connectivity Enhancement

Enhance the graph's navigability and completeness through principled link creation.

#### Link Types

| Type | Source | Trust Level |
|------|--------|-------------|
| **Asserted** | Curated sources, explicit extraction | High |
| **Derived** | Rules, inference, reasoning | Medium-High |
| **Associative** | Statistics, embeddings, co-occurrence | Variable |

#### Enhancement Methods

**Ontology-driven**
- Materialize inferred relations via OWL reasoning
- Apply domain rules (SWRL, SPARQL CONSTRUCT)

**Statistical**
- Co-occurrence in documents or queries
- Shared attributes or neighbors
- Embedding similarity

**Multi-hop paths**
- Discover latent structure via property paths
- Materialize high-value shortcuts with provenance

#### Connectivity Governance

- Constrain with domain/range and SHACL shapes
- Weight links by usage and outcome success
- Apply decay to weak/unused links (sparsification)
- Create hub concepts (topics, events) to shorten paths

## Lifecycle Management

### Record States

Every record progresses through defined lifecycle states:

```
┌──────────┐     ┌──────────┐     ┌─────────────┐
│  DRAFT   │────▶│PROBATION │────▶│ CONSOLIDATED│
│(staging) │     │(testing) │     │  (active)   │
└──────────┘     └──────────┘     └─────────────┘
                      │                  │
                      ▼                  ▼
               ┌──────────┐       ┌──────────┐
               │ REJECTED │       │DEPRECATED│
               └──────────┘       └──────────┘
                                       │
                                       ▼
                                ┌──────────┐
                                │ ARCHIVED │
                                └──────────┘
```

| State | Description | Query Visibility |
|-------|-------------|------------------|
| **Draft** | Newly ingested, unvalidated | Staging queries only |
| **Probationary** | Passed basic checks, under observation | Internal queries |
| **Consolidated** | Fully validated, high confidence | All queries |
| **Deprecated** | Superseded or stale, pending review | Explicit requests |
| **Archived** | Historical record, minimal index | Deep retrieval, audit |
| **Tombstoned** | Retracted with reasons, excluded | Provenance queries only |

### Temporal Decay

Apply decay to manage record salience over time:

#### Decay Functions

| Function | Formula | Behavior |
|----------|---------|----------|
| **Exponential** | `score * e^(-λt)` | Fast initial decay, good for ephemeral |
| **Power-law** | `score * t^(-α)` | Slow decay, long tail for durable facts |
| **Step** | `score if t < threshold else 0` | Hard cutoff at specific age |
| **Hybrid** | Varies by type/domain | Different decay for different classes |

#### Decay Modifiers

| Event | Effect |
|-------|--------|
| **Retrieval** | Reset or slow decay (reinforcement) |
| **Corroboration** | Slow decay (new evidence) |
| **Contradiction** | Accelerate decay (disputed) |
| **User correction** | Accelerate decay or immediate flag |

#### Decay vs. Deletion

| Action | When to Use |
|--------|-------------|
| **Decay** | Reduce retrieval priority while preserving data |
| **Summarize** | Compress low-salience items into stable summaries |
| **Archive** | Move to cold storage with sparse index |
| **Delete** | Privacy/legal requirements, policy violations |

**Principle**: Decay salience before deleting truth. Keep fossil records for audit and learning.

### Pruning Strategies

| Strategy | Criteria | Safeguards |
|----------|----------|------------|
| **Staleness** | Time since last validation > threshold | Check for evergreen status |
| **Disuse** | Retrieval frequency below threshold | Verify not just rare but valuable |
| **Redundancy** | Duplicate or subsumed by other records | Ensure consolidation happened |
| **Conflict** | Persistent contradiction, low trust | Preserve for learning |
| **Policy** | Compliance, safety, legal | Document reason, maintain tombstone |

### Storage Stratification

Organize storage into tiers for performance and governance:

| Tier | Characteristics | Contents |
|------|-----------------|----------|
| **Hot (Working)** | Fast access, high plasticity | Active hypotheses, recent traces, high-retrieval items |
| **Warm (Canonical)** | Standard access, stable | Validated facts, consolidated entities |
| **Cold (Archive)** | Slow access, cheap storage | Historical versions, deprecated content, audit trails |

#### Promotion/Demotion Criteria

| Direction | Trigger |
|-----------|---------|
| **Promote to Hot** | High retrieval frequency, active task relevance |
| **Promote to Warm** | Passed validation, corroboration received |
| **Demote to Cold** | Low access, staleness, superseded |
| **Demote to Contested** | New contradicting evidence (don't just overwrite) |

## Provenance and Versioning

### What to Track

#### Statement-Level Provenance

| Field | Description | Example |
|-------|-------------|---------|
| **source** | Origin of the claim | `wikidata:Q123`, `document:abc.pdf` |
| **assertion_time** | When the claim was made | `2024-01-15T10:30:00Z` |
| **source_time** | When the source was published | `2023-06-01` |
| **validity_interval** | Period when claim holds | `[2020-01-01, 2023-12-31]` |
| **extraction_method** | How it was extracted | `llm:gpt-4`, `regex:date_pattern` |
| **confidence** | Extraction/validation confidence | `0.92` |
| **curator** | Agent/human who validated | `agent:validator-v2`, `user:alice` |

#### Curation Event Provenance

| Event Type | Fields |
|------------|--------|
| **Merge** | Merged entities, resolution method, evidence |
| **Split** | Original entity, resulting entities, reason |
| **Validation** | Check type, result, evidence used |
| **Conflict resolution** | Competing values, winner, rationale |
| **Deprecation** | Reason, superseding record, effective date |
| **Repair** | Original value, new value, repair method |

#### Operational Provenance

| Field | Description |
|-------|-------------|
| **retrieval_count** | How often accessed |
| **last_accessed** | Most recent retrieval |
| **task_contexts** | Which tasks used this record |
| **co-activation** | Records frequently retrieved together |
| **outcome_impact** | Contribution to successful/failed tasks |

### Version Control

#### Automatic Versioning

- Every modification creates a new version
- Preserve previous versions in archive tier
- Maintain version chain with timestamps

```turtle
ex:entity1_v2 prov:wasRevisionOf ex:entity1_v1 ;
              prov:generatedAtTime "2024-01-15" ;
              prov:wasAttributedTo ex:curator-agent .
```

#### Rollback Capability

- Support reverting to previous versions
- Track rollback operations as provenance events
- Maintain "undo stack" for recent changes

### Attribution Chains

Track the full lineage of derived facts:

```
Original Source → Extraction → Validation → Enrichment → Current State
```

For each step, record:
- What transformation was applied
- By which agent/method
- With what confidence
- Based on what evidence

## Advanced Operations

### Graph Analytics for Curation

Use the graph structure itself to guide curation:

| Metric | Curation Use |
|--------|--------------|
| **Centrality** | Prioritize high-centrality nodes for validation |
| **Clustering coefficient** | Identify well-connected vs. orphan regions |
| **Path density** | Find areas needing connectivity enhancement |
| **Contradiction clusters** | Locate systematic quality issues |
| **Coverage gaps** | Identify missing entity types or relations |

### Self-Referential Analysis

The KG can reason about its own quality and dynamics:

#### Meta-Knowledge Queries

```sparql
# Find high-usage but low-confidence facts
SELECT ?fact ?confidence ?retrieval_count
WHERE {
  ?fact :confidence ?confidence ;
        :retrievalCount ?retrieval_count .
  FILTER(?confidence < 0.7 && ?retrieval_count > 100)
}
```

#### Diagnostic Signals

| Signal | Indicates | Response |
|--------|-----------|----------|
| **Trust trajectory** | Confidence trend over time | Investigate declining trust |
| **Drift indicators** | Contradiction rate increasing | Trigger reconciliation |
| **Bias detection** | Overrepresentation of sources/types | Diversify extraction |
| **Calibration error** | Confidence doesn't match accuracy | Retrain confidence estimators |

### Predictive Operations

#### Connection Prediction

Use graph structure to predict missing links:
- Embedding-based similarity
- Path pattern matching
- Type constraint satisfaction

#### Property Inference

Infer missing property values:
- Similar entity interpolation
- Rule-based derivation
- ML-based prediction with confidence

#### Proactive Maintenance

Predict which records will need curation:
- Staleness prediction based on type and domain
- Conflict prediction based on source patterns
- Quality degradation modeling

## Practical Considerations

### Automation Challenges

**What can be automated:**
- Syntactic validation
- Schema constraint checking
- Duplicate detection with high confidence
- Metrics calculation
- Safe repairs (normalization, canonicalization)

**What requires human involvement:**
- Semantic accuracy judgment
- Edge case resolution
- Quality threshold definition
- Domain-specific validation rules
- High-impact merge decisions

### Cost-Effectiveness

Balance curation depth against budget:

| Approach | Cost | Quality | Scale |
|----------|------|---------|-------|
| Fully manual | High | High | Low |
| Crowdsourced | Medium | Medium | Medium |
| Automated + sampling | Low | Medium | High |
| Hybrid (auto + human review) | Medium | High | Medium |

Recommendation: Start with automated detection, use human review for:
- High-impact decisions
- Ambiguous cases
- Quality calibration

### Prevention vs. Correction

Prevention is more cost-effective than correction:

| Strategy | Implementation |
|----------|----------------|
| **Schema enforcement** | Validate on ingestion, reject invalid data |
| **Source vetting** | Assess source quality before integration |
| **Input validation** | Check data at entry points |
| **Change review** | Review modifications before commit |
| **Canary writes** | Test in sandbox before production |

### Precomputation Strategies

For performance-critical curation:

| Strategy | Use Case |
|----------|----------|
| **Materialized quality scores** | Pre-compute dimension scores on write |
| **Incremental validation** | Re-validate only changed subgraphs |
| **Batch consolidation** | Accumulate changes, process in batches |
| **Background decay** | Run decay sweeps during low-load periods |

### Event Streaming

For real-time curation:

| Event | Action |
|-------|--------|
| **Entity created** | Queue for validation, compute initial fitness |
| **Link added** | Check consistency, update connectivity metrics |
| **Query executed** | Update retrieval counts, reinforce accessed records |
| **Task completed** | Log outcome, update utility scores |
| **Contradiction detected** | Trigger reconciliation workflow |

### Janitorial Operations

Regular maintenance tasks:

| Task | Frequency | Purpose |
|------|-----------|---------|
| **Decay sweep** | Daily/Weekly | Apply decay functions, archive stale records |
| **Orphan detection** | Weekly | Find disconnected nodes for review |
| **Index refresh** | As needed | Rebuild indexes after bulk changes |
| **Provenance audit** | Monthly | Verify provenance completeness |
| **Schema drift check** | Monthly | Ensure data still matches schema |
| **Backup verification** | Weekly | Confirm backup integrity |

### User-in-the-Loop

Effective curation often involves human feedback:

- **Quality scoring interfaces**: Let users rate fact accuracy
- **Correction workflows**: Easy mechanisms to report/fix errors
- **Expert review queues**: Route difficult cases to domain experts
- **Feedback loops**: Use corrections to improve automated systems

### Scalability Concerns

At scale, consider:

- **Sampling strategies**: Validate representative subsets
- **Prioritization**: Focus on high-impact entities/relationships
- **Parallelization**: Distribute checking across workers
- **Incremental processing**: Avoid re-validating unchanged data
- **Tiered validation**: Different rigor for different quality tiers

### Completeness vs. Correctness Trade-off

Often in tension:
- Aggressive cleaning improves correctness but may reduce completeness
- Permissive ingestion improves completeness but may reduce correctness

**Recommendation**: Define acceptable thresholds for both, monitor metrics, adjust curation intensity to maintain balance.

## Tools Reference

### Assessment Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **Luzzu** | Quality assessment framework | Extensible quality metrics |
| **RDFUnit** | Data quality testing | SPARQL-based test cases |
| **SPARQL queries** | Custom metrics | Flexible but requires expertise |

### Cleaning Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **SHACL validators** | Constraint validation | TopQuadrant, Apache Jena |
| **ShEx validators** | Shape validation | shex.js, PyShEx |
| **OWL reasoners** | Consistency checking | HermiT, Pellet, ELK |
| **OpenRefine** | Interactive cleaning | Good for exploration |

### Enrichment Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **LIMES** | Link discovery | Scalable, configurable |
| **Silk** | Instance matching | ML-based matching |
| **KnoFuss** | Knowledge fusion | Conflict resolution |
| **MinHash/LSH** | Duplicate detection | Approximate, scalable |

### Lifecycle Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **Named graphs** | State/tier management | Track provenance, enable quarantine |
| **Temporal RDF** | Validity intervals | Model time-varying facts |
| **W3C PROV** | Provenance tracking | Standard provenance vocabulary |
| **Version control** | Change tracking | Git-like semantics for KGs |

## Summary

Effective knowledge graph curation requires:

1. **Clear quality goals** - Define which dimensions matter for your application
2. **Fitness-driven operations** - Aggregate quality into actionable fitness scores
3. **Iterative process** - Continuous improvement, not one-time cleaning
4. **Layered detection** - Verification + validation + inference + behavioral signals
5. **Graduated responses** - Flag, quarantine, demote before delete
6. **Lifecycle management** - Decay, stratification, and explicit state transitions
7. **Rich provenance** - Track everything for audit, learning, and rollback
8. **Balanced approach** - Combine automated and human review
9. **Prevention focus** - Catch errors at ingestion when possible
10. **Self-awareness** - Use analytics to guide curation priorities

Quality is not binary. Set realistic thresholds, measure progress, and improve incrementally. The goal is a KG that is both **structurally sound** and **operationally fit** for its intended tasks.

---

## References

- Huaman, E., & Fensel, D. (2021). Knowledge Graph Curation: A Practical Framework. In *Proceedings of the 10th International Joint Conference on Knowledge Graphs* (IJCKG 2021).
- Zaveri, A., et al. (2016). Quality assessment for linked data: A survey. *Semantic Web*, 7(1), 63-93.
- Paulheim, H. (2017). Knowledge graph refinement: A survey of approaches and evaluation methods. *Semantic Web*, 8(3), 489-508.
