/* ═══════════════════════════════════════════════════════════════
   기출뷰어 · 검수 화면용 SQL — 하나로 합친 판 (v217)

   Supabase → SQL Editor 에 통째로 붙여넣고 «Run» 한 번.
   앞서 v212 · v216 을 이미 돌렸어도 그냥 이것만 다시 돌리면 됨.
   여러 번 돌려도 안전함 — 있으면 건너뛰고, 자료는 안 지움.

   ※ 돌리는 중에 «... does not exist, skipping» 이라고 뜨는 것은 정상임.
     옛 판 함수를 지우려다 없어서 건너뛴 것일 뿐, 잘못된 게 아님.

   ── 이 파일이 하는 일 ──────────────────────────────────────
     1. 칸 만들기          st_q·st_a·st_sol·frags·cand·sol_ver·sol_by·src_hash·dup_of
     2. 색인
     3. 함수 아홉 개       빈 번호 채우기 · 쪼개기 · 번호 다시 매기기 ·
                          문항 지우기 · 문항 옮기기 · 상태 다시 맞추기
     4. 권한
     5. 상태 한 번 맞추기  ← 이번 판의 핵심
   ═══════════════════════════════════════════════════════════════ */


/* ═══ 1. 칸 만들기 ═══════════════════════════════════════════

   st_q · st_a · st_sol   슬롯 상태 : empty | raw | draft | ok
                          empty=없음 · raw=검수 전 · draft=검수함 · ok=확정
   frags                  조각 배열 — 한 문항이 여러 장에 걸칠 때
   cand                   재업로드 후보 — 덮어쓰지 않고 여기 쌓임
   sol_ver · sol_by       해설 판 번호와 만든 모델
   src_hash               같은 파일 두 번 올리는 것 걸러내기
   dup_of                 사본일 때 원본의 id — 지우지 않고 표시만          */
alter table public.practicals
  add column if not exists st_q     text,
  add column if not exists st_a     text,
  add column if not exists st_sol   text,
  add column if not exists frags    jsonb default '[]'::jsonb,
  add column if not exists cand     jsonb default '[]'::jsonb,
  add column if not exists sol_ver  int   default 0,
  add column if not exists sol_by   text,
  add column if not exists src_hash text,
  add column if not exists dup_of   bigint;

alter table public.practicals
  alter column st_q   set default 'empty',
  alter column st_a   set default 'empty',
  alter column st_sol set default 'empty';

comment on column public.practicals.dup_of is
  '이 행이 사본일 때 원본 practicals.id. 비어 있으면 원본이거나 중복이 아님.';


/* ═══ 2. 색인 ════════════════════════════════════════════════ */

/* 격자를 그릴 때 회차 단위로 훑는다 */
create index if not exists practicals_sheet_idx
  on public.practicals (subject_id, year, session, no);

/* 사본은 몇 개 안 되므로 부분 색인으로 충분하다 */
create index if not exists practicals_dup_idx
  on public.practicals (dup_of) where dup_of is not null;


/* ═══ 3. 함수 ════════════════════════════════════════════════ */

/* ── 3-1. 상태 다시 맞추기 ────────────────────────────────────
   ★ v217 에서 새로 넣은 것. 이번에 꼭 돌려야 하는 함수다.

   ── 무슨 일이 있었나 ──
   st_q·st_a·st_sol 은 기본값이 'empty' 인데, PDF 자동변환이 문항을
   올릴 때 이 세 칸을 안 적었다. 그림(q_url)과 글(q_text)은 멀쩡히
   들어갔는데 상태만 'empty' 로 남은 것이다.

   검수 화면은 상태 칸을 보고 세므로, 자료가 다 있는 1000문항 넘게가
   «세 칸 다 빈 껍데기» 로 잡혔다. 자료가 사라진 게 아니라
   꼬리표만 안 붙은 것이다.

   ── 이 함수가 하는 일 ──
     · 자료가 있는데 'empty'   →  'raw'(검수 전) 로 올림
     · 자료가 없는데 'raw' 이상 →  'empty' 로 내림
     · 사람이 붙인 'draft'·'ok' →  건드리지 않음
   자료 칸(q_url·q_text·…)은 절대 안 건드린다. 꼬리표만 고친다.
   여러 번 돌려도 결과가 같다.

   p_subject 를 비우면 모든 과목을 한 번에 맞춘다.                */
create or replace function public.resync_status(p_subject bigint default null)
returns int
language plpgsql security invoker as $$
declare n int;
begin
  with fixed as (
    update public.practicals p set
      st_q = case
               when (p.q_url is not null
                     or coalesce(p.q_text,'') <> ''
                     or coalesce(p.q_md,'')   <> '')
                 then case when coalesce(p.st_q,'empty') = 'empty'
                           then 'raw' else p.st_q end
               else 'empty' end,
      st_a = case
               when (p.a_url is not null
                     or coalesce(p.a_text,'') <> ''
                     or coalesce(p.a_md,'')   <> '')
                 then case when coalesce(p.st_a,'empty') = 'empty'
                           then 'raw' else p.st_a end
               else 'empty' end,
      st_sol = case
               when coalesce(p.easy_md,'') <> ''
                 then case when coalesce(p.st_sol,'empty') = 'empty'
                           then 'raw' else p.st_sol end
               else 'empty' end
     where (p_subject is null or p.subject_id = p_subject)
    returning 1)
  select count(*) into n from fixed;
  return n;
end $$;


/* ── 3-2. 빈 번호 채우기 ──────────────────────────────────────
   «20번이 있으면 1~19번도 있어야 한다».
   빠진 번호를 빈 행으로 만들고, 만든 개수를 돌려준다.

   p_upto 로 «이 회차는 19문항» 이라고 알려 줄 수 있다.
   여태는 이미 있는 «가장 큰 번호» 까지만 채웠는데, 자료가 3번·11~15번만
   들어온 회차는 max 가 15 라서 16~19번이 아예 안 만들어졌다.
   뒤쪽이 통째로 빠진 채 «다 찼다» 처럼 보이던 원인이다.            */
drop function if exists public.fill_missing_items(bigint,int,int);
drop function if exists public.fill_missing_items(bigint,int,int,int);

create function public.fill_missing_items(
  p_subject bigint, p_year int, p_session int, p_upto int default null
) returns int
language plpgsql security invoker as $$
declare mx int; made int := 0;
begin
  select max(no) into mx from public.practicals
   where subject_id = p_subject and year = p_year and session = p_session;

  mx := greatest(coalesce(mx, 0), coalesce(p_upto, 0));
  if mx <= 0 then return 0; end if;
  if mx > 600 then mx := 600; end if;      /* 실수로 큰 값이 들어오는 것 막기 */

  insert into public.practicals (subject_id, year, session, no, st_q, st_a, st_sol)
  select p_subject, p_year, p_session, g, 'empty', 'empty', 'empty'
    from generate_series(1, mx) as g
   where not exists (
     select 1 from public.practicals p
      where p.subject_id = p_subject and p.year = p_year
        and p.session = p_session and p.no = g);

  get diagnostics made = row_count;
  return made;
end $$;


/* 한 과목의 모든 회차를 한 번에 */
drop function if exists public.fill_missing_all(bigint);
drop function if exists public.fill_missing_all(bigint,int);

create function public.fill_missing_all(
  p_subject bigint, p_upto int default null
) returns int
language plpgsql security invoker as $$
declare r record; total int := 0;
begin
  for r in select distinct year, session from public.practicals
            where subject_id = p_subject
  loop
    total := total + public.fill_missing_items(p_subject, r.year, r.session, p_upto);
  end loop;
  return total;
end $$;


/* ── 3-3. 쪼개기 ──────────────────────────────────────────────
   한 칸에 두 문항이 들어가 있을 때 쓴다.
   p_no 뒤의 번호를 전부 한 칸씩 밀고, p_no+1 자리에 빈 행을 만든다.

   ★ 번호를 바로 +1 하면 (subject,year,session,no) 고유키에 부딪힌다.
     그래서 잠깐 음수로 옮겼다가 되돌리는 두 걸음으로 민다.
     한 함수 안에서 도니 중간에 끊겨도 통째로 취소된다.            */
create or replace function public.split_item(
  p_subject bigint, p_year int, p_session int, p_no int
) returns int
language plpgsql security invoker as $$
begin
  update public.practicals set no = -no
   where subject_id = p_subject and year = p_year
     and session = p_session and no > p_no;

  update public.practicals set no = (-no) + 1
   where subject_id = p_subject and year = p_year
     and session = p_session and no < 0;

  insert into public.practicals (subject_id, year, session, no, st_q, st_a, st_sol)
  values (p_subject, p_year, p_session, p_no + 1, 'empty', 'empty', 'empty');

  return p_no + 1;
end $$;


/* ── 3-4. 번호 다시 매기기 ────────────────────────────────────
   중간을 지워서 번호가 띄엄띄엄해졌을 때 1,2,3… 으로 다시 붙인다.
   지금 번호 순서는 그대로 지킨다.                                  */
create or replace function public.renumber_items(
  p_subject bigint, p_year int, p_session int
) returns int
language plpgsql security invoker as $$
declare moved int := 0;
begin
  /* 먼저 통째로 음수 쪽으로 피해 둔다 (고유키 충돌 방지) */
  update public.practicals set no = -no
   where subject_id = p_subject and year = p_year and session = p_session;

  with seq as (
    select id, row_number() over (order by -no) as rn
      from public.practicals
     where subject_id = p_subject and year = p_year
       and session = p_session and no < 0
  )
  update public.practicals p set no = s.rn
    from seq s where p.id = s.id;

  get diagnostics moved = row_count;
  return moved;
end $$;


/* ── 3-5. 문항 하나 지우기 ────────────────────────────────────
   빈 행을 잘못 만들었을 때. 뒤 번호는 자동으로 안 당겨진다 —
   당기려면 renumber_items 를 따로 부른다.                          */
create or replace function public.drop_item(
  p_subject bigint, p_year int, p_session int, p_no int
) returns int
language plpgsql security invoker as $$
declare n int;
begin
  delete from public.practicals
   where subject_id = p_subject and year = p_year
     and session = p_session and no = p_no;
  get diagnostics n = row_count;
  return n;
end $$;


/* ── 3-6. 문항 옮기기 ─────────────────────────────────────────
   «회차 미상» 덩어리(연도 9001 같은 것)에 쌓여 있는 문항을
   실제 회차의 빈자리로 옮긴다.

   가는 자리에 이미 행이 있으면
     · 그 행이 «완전히 비어 있는 껍데기» 면 지우고 자리를 내준다
     · 자료가 들어 있으면 아무것도 안 하고 -1 을 돌려준다 (덮어쓰지 않음) */
create or replace function public.move_item(
  p_subject bigint,
  p_from_year int, p_from_session int, p_from_no int,
  p_to_year   int, p_to_session   int, p_to_no   int
) returns int
language plpgsql security invoker as $$
declare tgt record;
begin
  select * into tgt from public.practicals
   where subject_id = p_subject and year = p_to_year
     and session = p_to_session and no = p_to_no;

  if found then
    if tgt.q_url is null and coalesce(tgt.q_text,'') = ''
       and tgt.a_url is null and coalesce(tgt.a_text,'') = ''
       and coalesce(tgt.easy_md,'') = ''
    then
      delete from public.practicals where id = tgt.id;   /* 빈 껍데기면 비켜 준다 */
    else
      return -1;                                          /* 자료가 있으면 손대지 않는다 */
    end if;
  end if;

  update public.practicals
     set year = p_to_year, session = p_to_session, no = p_to_no
   where subject_id = p_subject and year = p_from_year
     and session = p_from_session and no = p_from_no;

  return 1;
end $$;


/* ═══ 4. 권한 — 로그인한 사람이 쓸 수 있게 ═══════════════════ */
grant execute on function public.resync_status(bigint)                     to authenticated;
grant execute on function public.fill_missing_items(bigint,int,int,int)    to authenticated;
grant execute on function public.fill_missing_all(bigint,int)              to authenticated;
grant execute on function public.split_item(bigint,int,int,int)            to authenticated;
grant execute on function public.renumber_items(bigint,int,int)            to authenticated;
grant execute on function public.drop_item(bigint,int,int,int)             to authenticated;
grant execute on function public.move_item(bigint,int,int,int,int,int,int) to authenticated;


/* ═══ 5. 상태 한 번 맞추기 ═══════════════════════════════════
   여기서 실제로 꼬리표가 붙는다. 몇 줄을 손봤는지 숫자로 나온다.
   («검수 화면 → 상태 다시 맞추기» 단추를 눌러도 같은 일이 일어난다) */
select public.resync_status() as 상태_맞춘_문항수;


/* ═══════════════════════════════════════════════════════════════
   확인 — 아래 두 개는 따로 골라서 실행해 보면 됨
   ═══════════════════════════════════════════════════════════════

   -- 전체 요약. «문제없음» 이 확 줄었으면 제대로 된 것.
   select count(*) as 전체,
          count(*) filter (where st_q   = 'empty') as 문제없음,
          count(*) filter (where st_a   = 'empty') as 답없음,
          count(*) filter (where st_sol = 'empty') as 해설없음,
          count(*) filter (where dup_of is not null) as 사본표시
     from public.practicals;

   -- 회차별로 몇 개가 비었는지
   select year, session,
          count(*)                                 as 문항수,
          count(*) filter (where st_q   = 'empty') as 문제없음,
          count(*) filter (where st_a   = 'empty') as 답없음,
          count(*) filter (where st_sol = 'empty') as 해설없음
     from public.practicals
    where dup_of is null
    group by year, session
    order by year desc, session desc;

   ───────────────────────────────────────────────────────────── */
