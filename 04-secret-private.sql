-- ============================================================
-- sniper — 비밀글 · 비공개 게시판 (04)
-- Supabase 프로젝트의 SQL Editor 에서 한 번 실행하세요.
-- 여러 번 실행해도 안전합니다(이미 있으면 건너뜁니다).
-- ============================================================

alter table blog_posts      add column if not exists secret     boolean not null default false;
alter table blog_categories add column if not exists is_private boolean not null default false;

-- ============================================================
-- 꼭 확인하세요 — Row Level Security(RLS)
-- ============================================================
-- 위 컬럼만 추가하면 "화면(index/post/write.html)에서" 비밀글·비공개
-- 게시판이 안 보이지만, 이건 화면 쪽 코드가 걸러 주는 것일 뿐입니다.
-- anon 키로 REST API 를 직접 두드리면 여전히 읽힐 수 있으므로, 진짜로
-- 숨기려면 blog_posts / blog_categories 의 RLS 정책에도 조건을 넣어야
-- 합니다.
--
-- Supabase 대시보드 → Authentication → Policies 에서 이 두 테이블에
-- 이미 걸려 있는 "anon(비로그인)이 읽을 수 있는 조건" 정책을 찾아
-- 아래처럼 조건만 추가해 주세요. 정책 이름과 정확한 기존 조건은
-- 프로젝트마다 달라서 여기서 자동으로 바꾸지 않았습니다.
--
-- 예시(정책 이름은 실제로 걸려 있는 이름으로 바꿔서 쓰세요):
--
--   drop policy if exists "anon can read published posts" on blog_posts;
--   create policy "anon can read published posts" on blog_posts
--     for select to anon
--     using (status = 'published' and secret = false);
--
--   drop policy if exists "anon can read categories" on blog_categories;
--   create policy "anon can read categories" on blog_categories
--     for select to anon
--     using (is_private = false);
--
-- 로그인한 본인(authenticated) 쪽 정책은 조건 없이 전체를 볼 수 있게
-- 그대로 두면 됩니다 — 이 블로그는 관리자 계정 하나만 로그인하므로,
-- "로그인했다 = 나" 로 취급해도 안전합니다.
