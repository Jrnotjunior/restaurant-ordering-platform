-- Optimize auth.uid() evaluation in RLS predicates.
-- Wrapping auth.uid() in a scalar subquery lets PostgreSQL evaluate it as an initPlan
-- instead of re-evaluating it for each candidate row. Policy predicates and role
-- scopes remain otherwise unchanged.

do $$
declare
  p record;
  using_expr text;
  check_expr text;
  create_sql text;
begin
  for p in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') like '%auth.uid()%'
        or coalesce(with_check, '') like '%auth.uid()%'
      )
  loop
    using_expr := case
      when p.qual is null then null
      else replace(p.qual, 'auth.uid()', '(select auth.uid())')
    end;
    check_expr := case
      when p.with_check is null then null
      else replace(p.with_check, 'auth.uid()', '(select auth.uid())')
    end;

    execute format('drop policy %I on %I.%I',
      p.policyname, p.schemaname, p.tablename);

    create_sql := format(
      'create policy %I on %I.%I as %s for %s to %s',
      p.policyname,
      p.schemaname,
      p.tablename,
      p.permissive,
      p.cmd,
      array_to_string(p.roles, ', ')
    );

    if using_expr is not null then
      create_sql := create_sql || format(' using (%s)', using_expr);
    end if;
    if check_expr is not null then
      create_sql := create_sql || format(' with check (%s)', check_expr);
    end if;

    execute create_sql;
  end loop;
end;
$$;
