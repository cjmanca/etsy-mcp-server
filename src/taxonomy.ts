import { performance } from "node:perf_hooks";
import { EtsyApiError } from "./etsy-client.js";

export const TAXONOMY_TYPES = ["buyer", "seller"] as const;
export type TaxonomyType = (typeof TAXONOMY_TYPES)[number];

export const MAX_TAXONOMY_DEPTH = 32;
export const MAX_TAXONOMY_TREE_NODES = 20_000;
export const MAX_TAXONOMY_NODE_NAME_LENGTH = 512;
export const MAX_TAXONOMY_CHILD_IDS = 25;
export const TAXONOMY_CACHE_TTL_MS = 15 * 60 * 1000;

export interface TaxonomyNode {
  readonly id: number;
  readonly name: string;
  readonly level: number;
  readonly parent_id: number | null;
  readonly child_ids: number[];
}

export interface TaxonomyTree {
  readonly nodes: TaxonomyNode[];
  readonly byId: Map<number, TaxonomyNode>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidTaxonomy(): EtsyApiError {
  return new EtsyApiError("upstream", "Etsy returned an invalid taxonomy tree.");
}

function upstreamId(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw invalidTaxonomy();
  }
  return value;
}

function matchesPath(value: unknown, expected: readonly number[]): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  return value.every(
    (item, index) =>
      typeof item === "number" &&
      Number.isSafeInteger(item) &&
      item === expected[index],
  );
}

/** Validate and flatten a complete Etsy taxonomy response before it is cached. */
export function normalizeTaxonomyTree(value: unknown): TaxonomyTree {
  if (!isObject(value) || !Array.isArray(value.results)) {
    throw invalidTaxonomy();
  }
  // Etsy's count describes the top-level results array of recursive roots.
  if (
    value.count !== undefined &&
    (typeof value.count !== "number" ||
      !Number.isSafeInteger(value.count) ||
      value.count < 0 ||
      value.count !== value.results.length)
  ) {
    throw invalidTaxonomy();
  }
  if (value.results.length > MAX_TAXONOMY_TREE_NODES) {
    throw invalidTaxonomy();
  }

  const nodes: TaxonomyNode[] = [];
  const byId = new Map<number, TaxonomyNode>();
  const stack: Array<{
    raw: unknown;
    parentId: number | null;
    parentPath: readonly number[];
    expectedLevel: number;
  }> = [];

  for (let index = value.results.length - 1; index >= 0; index -= 1) {
    stack.push({
      raw: value.results[index],
      parentId: null,
      parentPath: [],
      expectedLevel: 0,
    });
  }

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (nodes.length >= MAX_TAXONOMY_TREE_NODES) throw invalidTaxonomy();
    if (!isObject(current.raw)) throw invalidTaxonomy();

    const id = upstreamId(current.raw.id);
    if (byId.has(id)) throw invalidTaxonomy();
    const level = current.raw.level;
    if (
      typeof level !== "number" ||
      !Number.isSafeInteger(level) ||
      level !== current.expectedLevel ||
      level > MAX_TAXONOMY_DEPTH
    ) {
      throw invalidTaxonomy();
    }
    const name = current.raw.name;
    if (
      typeof name !== "string" ||
      name.trim().length === 0 ||
      name.length > MAX_TAXONOMY_NODE_NAME_LENGTH
    ) {
      throw invalidTaxonomy();
    }

    const upstreamParent = current.raw.parent_id;
    if (current.parentId === null) {
      if (upstreamParent !== undefined && upstreamParent !== null) {
        throw invalidTaxonomy();
      }
    } else if (
      upstreamParent !== undefined &&
      upstreamParent !== null &&
      (typeof upstreamParent !== "number" || upstreamParent !== current.parentId)
    ) {
      throw invalidTaxonomy();
    }

    const rawChildren = current.raw.children;
    if (rawChildren !== undefined && !Array.isArray(rawChildren)) {
      throw invalidTaxonomy();
    }
    const children = rawChildren ?? [];
    const path = [...current.parentPath, id];
    if (
      current.raw.full_path_taxonomy_ids !== undefined &&
      !matchesPath(current.raw.full_path_taxonomy_ids, path)
    ) {
      throw invalidTaxonomy();
    }

    const node: TaxonomyNode = {
      id,
      name,
      level,
      parent_id: current.parentId,
      child_ids: [],
    };
    byId.set(id, node);
    nodes.push(node);
    if (current.parentId !== null) {
      const parent = byId.get(current.parentId);
      if (!parent) throw invalidTaxonomy();
      parent.child_ids.push(id);
    }

    if (nodes.length + stack.length + children.length > MAX_TAXONOMY_TREE_NODES) {
      throw invalidTaxonomy();
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        raw: children[index],
        parentId: id,
        parentPath: path,
        expectedLevel: level + 1,
      });
    }
  }

  return { nodes, byId };
}

interface CacheEntry {
  readonly tree: TaxonomyTree;
  readonly expiresAt: number;
}

/** A two-key, in-memory cache that shares concurrent cold acquisitions. */
export class TaxonomyTreeCache {
  private readonly entries = new Map<TaxonomyType, CacheEntry>();
  private readonly inFlight = new Map<TaxonomyType, Promise<TaxonomyTree>>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  get(
    taxonomyType: TaxonomyType,
    load: () => Promise<unknown>,
  ): Promise<TaxonomyTree> {
    const now = this.now();
    const cached = this.entries.get(taxonomyType);
    if (cached && cached.expiresAt > now) return Promise.resolve(cached.tree);
    if (cached) this.entries.delete(taxonomyType);

    const existingRequest = this.inFlight.get(taxonomyType);
    if (existingRequest) return existingRequest;

    let request: Promise<TaxonomyTree>;
    request = Promise.resolve()
      .then(load)
      .then(normalizeTaxonomyTree)
      .then((tree) => {
        this.entries.set(taxonomyType, {
          tree,
          expiresAt: this.now() + TAXONOMY_CACHE_TTL_MS,
        });
        return tree;
      })
      .finally(() => {
        if (this.inFlight.get(taxonomyType) === request) {
          this.inFlight.delete(taxonomyType);
        }
      });
    this.inFlight.set(taxonomyType, request);
    return request;
  }
}
