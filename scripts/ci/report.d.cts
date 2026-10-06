// Types for the CI report helpers, which stay plain JavaScript so CI can run them before installing anything.
type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'info'
// `pnpm audit --json` output, loosely: only the fields the report reads.
type AuditReport = Record<string, unknown> | null
type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
// The workflow's `needs` context: each job's result and outputs.
type JobResults = Record<string, { result?: string; outputs?: Record<string, string> } | undefined>

export function auditCounts(report: AuditReport): Record<Severity, number> | null
export function packageDetails(report: AuditReport, manifest?: Manifest): string[]
export function summary(
  results: JobResults,
  env?: Record<string, string | undefined>,
  auditReport?: AuditReport,
  manifest?: Manifest
): string
