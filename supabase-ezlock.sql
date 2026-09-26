/* ═══════════════════════════════════════════════════════════════
   v267 · 문항별 «쉬운해설 고정» 칸 — ez_lock

   Supabase → SQL Editor 에 통째로 붙여넣고 «Run» 한 번.
   여러 번 돌려도 안전함 — 있으면 건너뛰고, 자료는 안 건드림.

   이걸 안 돌려도 고정 단추는 동작한다. 다만 그 기기(브라우저)에만 적힌다.
   돌리고 나서 실기 화면을 처음 열면, 그동안 기기에 적어 둔 고정이
   저절로 이 칸으로 옮겨지고, 그 뒤로는 PC·폰이 같은 값을 본다.
   ═══════════════════════════════════════════════════════════════ */
alter table public.practicals
  add column if not exists ez_lock boolean not null default false;

comment on column public.practicals.ez_lock is
  'true 면 AI 가 쉬운 풀이(easy_md)를 새로 만들거나 다시 쓰지 않는다. 손으로 고치기는 된다.';

/* 과목을 열 때 «고정된 것만» 묻는다 — 몇 개 안 되므로 부분 색인이면 충분 */
create index if not exists practicals_ezlock_idx
  on public.practicals (subject_id) where ez_lock;

/* API 가 새 칸을 바로 알아보게 */
notify pgrst, 'reload schema';
