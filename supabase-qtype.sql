/* ═══════════════════════════════════════════════════════════════
   v268 · 문항 «유형» 칸 — qtype

   Supabase → SQL Editor 에 통째로 붙여넣고 «Run» 한 번.
   여러 번 돌려도 안전함 — 있으면 건너뛰고, 자료는 안 건드림.

   같은 유형 이름을 가진 문항끼리 «중복 묶기» 에서 한 덩어리가 된다.
   이걸 안 돌려도 유형 붙이기는 동작한다. 다만 그 기기(브라우저)에만 적힌다.
   돌리고 나서 실기 화면을 새로고침하면, 그동안 기기에 적어 둔 유형이
   저절로 이 칸으로 옮겨지고, 그 뒤로는 PC·폰이 같은 값을 본다.
   ═══════════════════════════════════════════════════════════════ */
alter table public.practicals
  add column if not exists qtype text;

comment on column public.practicals.qtype is
  '사람이 붙인 문항 유형 이름. 같은 이름끼리 한 덩어리(중복 묶기)로 본다. 비어 있으면 유형 없음.';

/* 과목을 열 때 «유형이 붙은 줄만» 묻는다 — 부분 색인이면 충분 */
create index if not exists practicals_qtype_idx
  on public.practicals (subject_id, qtype) where qtype is not null;

/* ★ v273 — 중문항 · 소문항 칸 (대문항 = qtype) */
alter table public.practicals
  add column if not exists qtype2 text;
alter table public.practicals
  add column if not exists qtype3 text;

comment on column public.practicals.qtype2 is '중문항 유형 이름 (대문항 qtype 아래 한 단계)';
comment on column public.practicals.qtype3 is '소문항 유형 이름 (가장 좁은 갈래)';

create index if not exists practicals_qtype2_idx
  on public.practicals (subject_id, qtype2) where qtype2 is not null;
create index if not exists practicals_qtype3_idx
  on public.practicals (subject_id, qtype3) where qtype3 is not null;

/* API 가 새 칸을 바로 알아보게 */
notify pgrst, 'reload schema';
