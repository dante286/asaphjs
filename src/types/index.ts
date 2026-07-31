export type CollectionFeatures = {
  lending?: boolean;
  verified?: boolean;
  lookup?: string; // e.g. 'igdb', 'openlibrary' — see src/lib/metadata
};

export type ExternalRef = {
  source: string;
  id: string;
  fetchedAt: string;
};

export type ImportMappings = Record<string, string>; // csv header -> field id | '__title' | '__skip'

export type Role = "owner" | "editor" | "viewer" | "public" | null;

export * from "@/lib/fields/field-def";
