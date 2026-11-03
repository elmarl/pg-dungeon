import type { GameDatabase } from '../db.js'

const GAME_SCHEMAS = `n.nspname in ('clock', 'map', 'creature', 'screen', 'game')`

const SCHEMAS = `
  select n.nspname as schema, obj_description(n.oid, 'pg_namespace') as holds
  from pg_namespace n
  where ${GAME_SCHEMAS}
  order by array_position(array['game', 'screen', 'creature', 'map', 'clock'], n.nspname::text)`

const TABLES = `
  select n.nspname || '.' || c.relname as name,
         case c.relkind when 'r' then 'table' when 'v' then 'view' when 'm' then 'materialized view' else 'sequence' end as type,
         case when c.relrowsecurity then 'yes' else '' end as rls,
         concat_ws(', ',
           case when has_table_privilege(c.oid, 'select') then 'select' end,
           case when c.relkind = 'r' and has_table_privilege(c.oid, 'insert') then 'insert' end,
           case when c.relkind = 'r' and has_table_privilege(c.oid, 'update') then 'update' end,
           case when c.relkind = 'r' and has_table_privilege(c.oid, 'delete') then 'delete' end) as you_can
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where ${GAME_SCHEMAS} and c.relkind in ('r', 'v', 'm', 'S')
    and ($1::text is null or n.nspname = $1)
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'a')   -- Hide ID counters created automatically for tables.
  order by n.nspname, c.relkind, c.relname`

const COLUMNS = `
  select a.attname as column,
         format_type(a.atttypid, a.atttypmod) as type,
         case when a.attnotnull then 'not null' else '' end as nullable,
         case when a.attgenerated = 's' then 'generated: ' else '' end
           || coalesce(pg_get_expr(d.adbin, d.adrelid), '') as "default"
  from pg_attribute a
  left join pg_attrdef d on (d.adrelid, d.adnum) = (a.attrelid, a.attnum)
  where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
  order by a.attnum`

const CONSTRAINTS = `
  select conname as constraint, pg_get_constraintdef(oid) as definition
  from pg_constraint
  where conrelid = $1::regclass and contype <> 'n'
  order by contype, conname`

const POLICIES = `
  select pol.polname as policy, pg_get_expr(pol.polqual, pol.polrelid) as "visible when"
  from pg_policy pol
  where pol.polrelid = $1::regclass`

const VIEW = `select pg_get_viewdef($1::regclass, true) as definition`

const FUNCTIONS = `
  select n.nspname || '.' || p.proname as name,
         pg_get_function_arguments(p.oid) as arguments,
         pg_get_function_result(p.oid) as returns,
         case when p.prosecdef then 'owner (definer)' else 'caller' end as runs_as,
         case when has_function_privilege(p.oid, 'execute') then 'yes' else 'no' end as you_can_call
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where ${GAME_SCHEMAS}
  order by has_function_privilege(p.oid, 'execute') desc, n.nspname, p.proname`

const SOURCE = `select pg_get_functiondef($1::regproc) as source`

const HELP = [
  { command: '\\dn', shows: 'schemas: one per part of the game' },
  { command: '\\dt [schema]', shows: 'tables and views, and what the player role may do to each' },
  { command: '\\d <schema.table>', shows: 'columns, constraints and row-level security, or a view\'s query' },
  { command: '\\df', shows: 'functions, who they run as, and whether you may call them' },
  { command: '\\sf <schema.function>', shows: 'a function\'s source' },
  { command: 'anything else', shows: 'runs as SQL in a savepoint that is rolled back afterwards' },
]

type TableRow = Record<string, unknown>
type PsqlResult = { title: string; rows: TableRow[]; link?: { column: string; command: string }; pre?: boolean }

export async function runPsqlCommand(db: Pick<GameDatabase, 'rows'>, input: string): Promise<PsqlResult[]> {
  const [cmd, arg] = input.trim().split(/\s+/)
  const queryRows = (sql: string, params?: unknown[]) => db.rows(sql, params)

  switch (cmd) {
    case '\\?':
      return [{ title: 'Commands', rows: HELP }]
    case '\\dn':
      return [{ title: 'Schemas', rows: await queryRows(SCHEMAS), link: { column: 'schema', command: '\\dt' } }]
    case '\\dt':
      return [{ title: arg ? `Tables in ${arg}` : 'Tables', rows: await queryRows(TABLES, [arg ?? null]), link: { column: 'name', command: '\\d' } }]
    case '\\df':
      return [{ title: 'Functions', rows: await queryRows(FUNCTIONS), link: { column: 'name', command: '\\sf' } }]
    case '\\sf':
      return [{ title: `Function ${arg}`, rows: await queryRows(SOURCE, [arg]), pre: true }]
    case '\\d': {
      if (!arg) {
        return runPsqlCommand(db, '\\dt')
      }
      const [{ kind }] = (await queryRows('select relkind as kind from pg_class where oid = $1::regclass', [arg])) as Array<{ kind: string }>
      if (kind === 'v' || kind === 'm') {
        return [{ title: `View ${arg}`, rows: await queryRows(VIEW, [arg]), pre: true }]
      }
      return [
        { title: `Table ${arg}`, rows: await queryRows(COLUMNS, [arg]) },
        { title: 'Constraints', rows: await queryRows(CONSTRAINTS, [arg]) },
        { title: 'Row-level security', rows: await queryRows(POLICIES, [arg]) },
      ].filter((result) => result.rows.length)
    }
    default:
      throw new Error(`unknown command ${cmd}. Try \\?`)
  }
}
