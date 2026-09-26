/* ═══════════════════════════════════════════════════════════════
   v287 · 공부 기록 칸 — 회독·맞힘·틀림(prog) · 북마크(fav)

   Supabase → SQL Editor 에 통째로 붙여넣고 «Run» 한 번.
   여러 번 돌려도 안전함 — 있으면 건너뛰고, 자료는 안 건드림.

   돌린 뒤 실기 화면을 각 기기에서 한 번씩 열면, 그동안 기기마다 쌓인 기록이
   서버로 올라가 합쳐짐 (문항마다 나중에 바꾼 쪽이 이김).
   ═══════════════════════════════════════════════════════════════ */
alter table public.practicals
  add column if not exists prog jsonb;
alter table public.practicals
  add column if not exists fav jsonb;

comment on column public.practicals.prog is '공부 기록 {n:푼 횟수, ok:맞힌 횟수, no:틀린 횟수, r:마지막 결과, at:바꾼 시각(ms)} · n:0 = 지움';
comment on column public.practicals.fav  is '북마크 {on:true/false, at:바꾼 시각(ms)}';

/* 과목을 열 때 «기록이 있는 줄만» 묻는다 */
create index if not exists practicals_study_idx
  on public.practicals (subject_id) where prog is not null or fav is not null;

/* API 가 새 칸을 바로 알아보게 */
notify pgrst, 'reload schema';
