export interface UpdateQueryParts {
  setClause: string;
  values: unknown[];
}

/**
 * Keterangan: Menyusun bagian SET untuk query UPDATE hanya dari pemetaan
 * kolom yang sudah di-whitelist. Nilai tetap dikirim sebagai parameter
 * PostgreSQL ($1, $2, dst.) untuk mencegah SQL injection.
 */
export function buildUpdateQuery<T extends object>(
  data: T,
  columnMap: Partial<Record<keyof T, string>>,
  valueTransformers: Partial<Record<keyof T, (value: unknown) => unknown>> = {},
): UpdateQueryParts {
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const key of Object.keys(columnMap) as Array<keyof T>) {
    const value = data[key];
    const column = columnMap[key];

    if (value !== undefined && column) {
      const transform = valueTransformers[key];
      values.push(transform ? transform(value) : value);
      assignments.push(`${column} = $${values.length}`);
    }
  }

  if (assignments.length === 0) {
    throw new Error('Tidak ada field yang diberikan untuk update');
  }

  return {
    setClause: assignments.join(', '),
    values,
  };
}
