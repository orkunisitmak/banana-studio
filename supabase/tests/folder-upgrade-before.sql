-- Synthetic legacy corruption, installed before owner constraints exist.
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('00000000-0000-4000-8000-000000000001','upgrade-owner@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000002','upgrade-member@example.invalid',now());
INSERT INTO public.folders(id,user_id,name,parent_id,created_at) VALUES
 ('owner','00000000-0000-4000-8000-000000000001','Owner',NULL,1),
 ('foreign-child','00000000-0000-4000-8000-000000000002','Foreign child','owner',1),
 ('cycle-a','00000000-0000-4000-8000-000000000002','Cycle A',NULL,1),
 ('cycle-b','00000000-0000-4000-8000-000000000002','Cycle B','cycle-a',1),
 ('self','00000000-0000-4000-8000-000000000002','Self','self',1);
UPDATE public.folders SET parent_id='cycle-b' WHERE id='cycle-a';
INSERT INTO public.generations(id,user_id,created_at,folder_id) VALUES
 ('foreign-image','00000000-0000-4000-8000-000000000002',1,'owner'),
 ('valid-image','00000000-0000-4000-8000-000000000001',1,'owner');
INSERT INTO public.generations(id,user_id,type,status,created_at,task_id,metadata) VALUES
 ('legacy-video','00000000-0000-4000-8000-000000000002','video','processing',1,'legacy-video-task','{"falEndpoint":"minimax/h3-max/text-to-video"}');
INSERT INTO public.provider_tasks(provider,task_id,user_id) VALUES
 ('fal','legacy-video-task','00000000-0000-4000-8000-000000000002');
