export interface ReviewResult {
  severity: 'error' | 'warning' | 'info';
  rule: string;
  message: string;
  line?: number;
  file?: string;
}

export interface ReviewRule {
  name: string;
  severity: 'error' | 'warning' | 'info';
  check(line: string, lineNumber: number, context: ReviewContext): ReviewResult | null;
}

export interface ReviewContext {
  lines: string[];
  fileExtension: string;
}
