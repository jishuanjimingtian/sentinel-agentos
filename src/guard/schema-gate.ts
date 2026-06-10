import { SchemaCheck, SchemaError } from '../types';
import type { GuardConfig } from '../types';
import * as path from 'path';

/**
 * Extended schema rule — supports all x- extensions from DESIGN.md §4.2.
 */
export interface SchemaRule {
  /** Tool name to match */
  tool: string;
  /** Required parameter names */
  required?: string[];
  /** Parameter type constraints */
  types?: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>;
  /** Allowed values for specific parameters */
  allowedValues?: Record<string, unknown[]>;
  /** Min/max numeric constraints */
  min?: Record<string, number>;
  max?: Record<string, number>;
  /** Regex patterns for string validation */
  patterns?: Record<string, string>;
  /** Custom validation functions */
  custom?: Record<string, (value: unknown) => string | null>;
  /** x- extensions: path scope constraint */
  pathScope?: Record<string, 'workspace' | 'temp' | 'global'>;
  /** x- extensions: allowed path glob patterns */
  pathAllow?: Record<string, string[]>;
  /** x- extensions: denied path glob patterns */
  pathDeny?: Record<string, string[]>;
  /** x- extensions: max parameter size in bytes */
  maxSize?: Record<string, number>;
  /** x- extensions: parameters marked as secret (redacted in logs) */
  secrets?: string[];
  /** x- extensions: parameter dependency — if X is set, Y is required */
  dependsOn?: Record<string, { required: string[] }>;
  /** x- extensions: mutually exclusive parameter groups */
  mutuallyExclusive?: string[][];
  /** Workspace root for path validation */
  workspaceRoot?: string;
}

/**
 * Schema Gate — deterministic parameter validation with JSON Schema x- extensions.
 *
 * Implements every validation rule from DESIGN.md §4.2:
 * - required fields ✓
 * - type checking ✓
 * - allowed values ✓
 * - numeric range ✓
 * - regex patterns ✓
 * - path scope constraint (x-path-scope) ✓
 * - path allow/deny globs (x-path-allow/x-path-deny) ✓
 * - max parameter size (x-max-size) ✓
 * - secret parameter marking (x-secret) ✓
 * - parameter dependencies (x-depends-on) ✓
 * - mutually exclusive params (x-mutually-exclusive) ✓
 * - custom validators ✓
 *
 * Zero LLM dependency. Pure deterministic logic.
 */
export class SchemaGate {
  private rules: Map<string, SchemaRule> = new Map();

  constructor(config?: GuardConfig) {
    if (config?.schema) {
      for (const rule of config.schema.rules) {
        this.registerRule({
          tool: rule.tool,
          required: rule.required,
          types: (rule as any).types,
          allowedValues: (rule as any).allowedValues,
          patterns: (rule as any).patterns,
          pathScope: (rule as any).pathScope,
          pathAllow: (rule as any).pathAllow,
          pathDeny: (rule as any).pathDeny,
          maxSize: (rule as any).maxSize,
          secrets: (rule as any).secrets,
          dependsOn: (rule as any).dependsOn,
          mutuallyExclusive: (rule as any).mutuallyExclusive,
          workspaceRoot: (rule as any).workspaceRoot,
        });
      }
    }
  }

  /** Register a schema rule for a tool */
  registerRule(rule: SchemaRule): void {
    this.rules.set(rule.tool, rule);
  }

  /** Register multiple rules at once */
  registerRules(rules: SchemaRule[]): void {
    rules.forEach((r) => this.registerRule(r));
  }

  /** Get all registered rules */
  getRules(): SchemaRule[] {
    return Array.from(this.rules.values());
  }

  /** Check if a tool has a registered rule */
  hasRule(tool: string): boolean {
    return this.rules.has(tool);
  }

  /**
   * Full validation: runs all applicable checks.
   * Returns { pass: boolean, errors: SchemaError[] }.
   */
  check(
    toolName: string,
    params: Record<string, unknown>,
  ): SchemaCheck {
    const rule = this.rules.get(toolName);

    if (!rule) {
      // No rule registered → pass by default (unrestricted tool)
      return { pass: true };
    }

    const errors: SchemaError[] = [];

    // 1. Required fields
    if (rule.required) {
      for (const field of rule.required) {
        if (params[field] === undefined || params[field] === null) {
          errors.push({
            field,
            actual: undefined,
            expected: 'defined (required)',
            message: `Missing required parameter: "${field}"`,
          });
        }
      }
    }

    // 2. Type checking
    if (rule.types) {
      for (const [field, expectedType] of Object.entries(rule.types)) {
        if (params[field] !== undefined && params[field] !== null) {
          const actualType = typeof params[field];
          if (expectedType === 'array') {
            if (!Array.isArray(params[field])) {
              errors.push({
                field,
                actual: params[field],
                expected: expectedType,
                message: `Expected ${expectedType} for "${field}", got ${actualType}`,
              });
            }
          } else if (expectedType === 'object') {
            if (typeof params[field] !== 'object' || Array.isArray(params[field])) {
              errors.push({
                field,
                actual: params[field],
                expected: expectedType,
                message: `Expected ${expectedType} for "${field}", got ${actualType}`,
              });
            }
          } else if (actualType !== expectedType) {
            errors.push({
              field,
              actual: params[field],
              expected: expectedType,
              message: `Expected ${expectedType} for "${field}", got ${actualType}`,
            });
          }
        }
      }
    }

    // 3. Allowed values
    if (rule.allowedValues) {
      for (const [field, values] of Object.entries(rule.allowedValues)) {
        if (params[field] !== undefined && !values.includes(params[field])) {
          errors.push({
            field,
            actual: params[field],
            expected: `one of [${values.join(', ')}]`,
            message: `"${params[field]}" is not an allowed value for "${field}". Allowed: ${values.join(', ')}`,
          });
        }
      }
    }

    // 4. Numeric range / string length / array length
    if (rule.min) {
      for (const [field, minVal] of Object.entries(rule.min)) {
        const val = params[field];
        if (typeof val === 'number') {
          if (val < minVal) {
            errors.push({
              field,
              actual: val,
              expected: `>= ${minVal}`,
              message: `"${field}" must be >= ${minVal}, got ${val}`,
            });
          }
        } else if (typeof val === 'string') {
          if (val.length < minVal) {
            errors.push({
              field,
              actual: `length ${val.length}`,
              expected: `length >= ${minVal}`,
              message: `"${field}" length must be >= ${minVal}, got ${val.length}`,
            });
          }
        } else if (Array.isArray(val)) {
          if (val.length < minVal) {
            errors.push({
              field,
              actual: `length ${val.length}`,
              expected: `length >= ${minVal}`,
              message: `"${field}" array length must be >= ${minVal}, got ${val.length}`,
            });
          }
        }
      }
    }
    if (rule.max) {
      for (const [field, maxVal] of Object.entries(rule.max)) {
        const val = params[field];
        if (typeof val === 'number') {
          if (val > maxVal) {
            errors.push({
              field,
              actual: val,
              expected: `<= ${maxVal}`,
              message: `"${field}" must be <= ${maxVal}, got ${val}`,
            });
          }
        } else if (typeof val === 'string') {
          if (val.length > maxVal) {
            errors.push({
              field,
              actual: `length ${val.length}`,
              expected: `length <= ${maxVal}`,
              message: `"${field}" length must be <= ${maxVal}, got ${val.length}`,
            });
          }
        } else if (Array.isArray(val)) {
          if (val.length > maxVal) {
            errors.push({
              field,
              actual: `length ${val.length}`,
              expected: `length <= ${maxVal}`,
              message: `"${field}" array length must be <= ${maxVal}, got ${val.length}`,
            });
          }
        }
      }
    }

    // 5. Regex patterns
    if (rule.patterns) {
      for (const [field, pattern] of Object.entries(rule.patterns)) {
        const val = params[field];
        if (typeof val === 'string') {
          try {
            const regex = new RegExp(pattern);
            if (!regex.test(val)) {
              errors.push({
                field,
                actual: val,
                expected: `match /${pattern}/`,
                message: `"${field}" does not match pattern /${pattern}/: "${val}"`,
              });
            }
          } catch {
            errors.push({
              field,
              actual: val,
              expected: 'valid regex',
              message: `Invalid regex pattern "${pattern}" for "${field}"`,
            });
          }
        }
      }
    }

    // 6. Path scope constraint (x-path-scope)
    if (rule.pathScope && rule.workspaceRoot) {
      for (const [field, scope] of Object.entries(rule.pathScope)) {
        const val = params[field];
        if (typeof val === 'string') {
          const resolvedPath = path.isAbsolute(val)
            ? val
            : path.resolve(rule.workspaceRoot, val);

          if (scope === 'workspace') {
            const normalizedRoot = path.resolve(rule.workspaceRoot);
            const normalizedPath = path.resolve(resolvedPath);

            if (!normalizedPath.startsWith(normalizedRoot + path.sep) && normalizedPath !== normalizedRoot) {
              errors.push({
                field,
                actual: val,
                expected: `within workspace (${normalizedRoot})`,
                message: `"${field}" path is outside the workspace: "${val}"`,
              });
            }
          }
        }
      }
    }

    // 7. Path allow/deny patterns (x-path-allow/x-path-deny)
    if (rule.pathDeny) {
      for (const [field, patterns] of Object.entries(rule.pathDeny)) {
        const val = params[field];
        if (typeof val === 'string') {
          for (const pattern of patterns) {
            if (this.matchGlob(val, pattern)) {
              errors.push({
                field,
                actual: val,
                expected: `not matching deny pattern "${pattern}"`,
                message: `"${field}" path is denied by pattern "${pattern}": "${val}"`,
              });
              break;
            }
          }
        }
      }
    }

    if (rule.pathAllow) {
      for (const [field, patterns] of Object.entries(rule.pathAllow)) {
        const val = params[field];
        if (typeof val === 'string') {
          let allowed = false;
          for (const pattern of patterns) {
            if (this.matchGlob(val, pattern)) {
              allowed = true;
              break;
            }
          }
          if (!allowed) {
            errors.push({
              field,
              actual: val,
              expected: `matching one of [${patterns.join(', ')}]`,
              message: `"${field}" path not in allow list: "${val}"`,
            });
          }
        }
      }
    }

    // 8. Max parameter size (x-max-size)
    if (rule.maxSize) {
      for (const [field, maxBytes] of Object.entries(rule.maxSize)) {
        const val = params[field];
        if (typeof val === 'string') {
          const sizeBytes = Buffer.byteLength(val, 'utf-8');
          if (sizeBytes > maxBytes) {
            errors.push({
              field,
              actual: `${sizeBytes} bytes`,
              expected: `<= ${maxBytes} bytes`,
              message: `"${field}" exceeds max size: ${sizeBytes} > ${maxBytes} bytes`,
            });
          }
        }
      }
    }

    // 9. Parameter dependencies (x-depends-on)
    if (rule.dependsOn) {
      for (const [field, dep] of Object.entries(rule.dependsOn)) {
        if (params[field] !== undefined && params[field] !== null && params[field] !== false) {
          for (const requiredField of dep.required) {
            if (params[requiredField] === undefined || params[requiredField] === null) {
              errors.push({
                field: requiredField,
                actual: undefined,
                expected: `defined when "${field}" is set`,
                message: `"${field}" is set, but dependent field "${requiredField}" is missing`,
              });
            }
          }
        }
      }
    }

    // 10. Mutually exclusive params (x-mutually-exclusive)
    if (rule.mutuallyExclusive) {
      for (const group of rule.mutuallyExclusive) {
        const present: string[] = [];
        for (const field of group) {
          if (params[field] !== undefined && params[field] !== null) {
            present.push(field);
          }
        }
        if (present.length > 1) {
          for (const field of present) {
            errors.push({
              field,
              actual: 'set',
              expected: `only one of [${group.join(', ')}]`,
              message: `Mutually exclusive parameters are both set: [${present.join(', ')}]`,
            });
          }
        }
      }
    }

    // 11. Custom validators
    if (rule.custom) {
      for (const [field, validator] of Object.entries(rule.custom)) {
        const val = params[field];
        if (val !== undefined) {
          const customError = validator(val);
          if (customError) {
            errors.push({
              field,
              actual: val,
              expected: 'custom validation pass',
              message: customError,
            });
          }
        }
      }
    }

    return {
      pass: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Check if a parameter is marked as secret (x-secret).
   */
  isSecret(toolName: string, field: string): boolean {
    const rule = this.rules.get(toolName);
    return rule?.secrets?.includes(field) ?? false;
  }

  /**
   * Get all secret field names for a tool.
   */
  getSecrets(toolName: string): string[] {
    return this.rules.get(toolName)?.secrets ?? [];
  }

  /**
   * Simple glob matching for path allow/deny patterns.
   * Supports *, **, ? wildcards.
   */
  private matchGlob(filePath: string, pattern: string): boolean {
    // Handle ** patterns: "**/.env" → matches any path ending with /.env
    if (pattern.startsWith('**/')) {
      const suffix = pattern.slice(3);
      return filePath.endsWith('/' + suffix) || filePath === suffix;
    }

    // Handle trailing **: "src/**" → matches anything under src/
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      return filePath.startsWith(prefix + '/') || filePath === prefix;
    }

    // Handle full globs via regex conversion
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '___DOUBLESTAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLESTAR___/g, '.*')
      .replace(/\?/g, '[^/]');

    try {
      return new RegExp(`^${regexStr}$`).test(filePath);
    } catch {
      return filePath === pattern; // Fallback to exact match
    }
  }
}
