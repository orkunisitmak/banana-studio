-- Block writes while legacy links are repaired and the new constraints install.
LOCK TABLE public.folders,public.generations IN ACCESS EXCLUSIVE MODE;
-- Detach legacy foreign associations without deleting anyone's folders/media.
UPDATE public.generations g SET folder_id=NULL
 WHERE folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.folders f WHERE f.id=g.folder_id AND f.user_id=g.user_id);
UPDATE public.folders f SET parent_id=NULL
 WHERE parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.folders p WHERE p.id=f.parent_id AND p.user_id=f.user_id);
-- Detach every cyclic ancestry, including legacy self-links. UNION bounds the
-- walk even when pre-migration data already contains a cycle.
WITH RECURSIVE ancestry(root,id) AS (
 SELECT id,parent_id FROM public.folders WHERE parent_id IS NOT NULL
 UNION
 SELECT a.root,f.parent_id FROM ancestry a JOIN public.folders f ON f.id=a.id WHERE f.parent_id IS NOT NULL
)
UPDATE public.folders SET parent_id=NULL WHERE id IN(SELECT root FROM ancestry WHERE root=id);
ALTER TABLE public.folders ADD CONSTRAINT folders_owner_id_key UNIQUE(user_id,id);
ALTER TABLE public.folders DROP CONSTRAINT folders_parent_id_fkey;
ALTER TABLE public.folders ADD CONSTRAINT folders_parent_owner_fkey
 FOREIGN KEY(user_id,parent_id) REFERENCES public.folders(user_id,id) ON DELETE CASCADE;
ALTER TABLE public.generations DROP CONSTRAINT generations_folder_id_fkey;
ALTER TABLE public.generations ADD CONSTRAINT generations_folder_owner_fkey
 FOREIGN KEY(user_id,folder_id) REFERENCES public.folders(user_id,id) ON DELETE SET NULL(folder_id);

CREATE FUNCTION private.check_folder_ancestry() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Serialize hierarchy edits so two concurrent reparentings cannot each pass
 -- against the old graph and create a cycle together.
 PERFORM pg_catalog.pg_advisory_xact_lock(711902,3);
 IF NEW.parent_id IS NOT NULL AND (NEW.parent_id=NEW.id OR EXISTS(
   WITH RECURSIVE ancestors(id,parent_id) AS (
    SELECT id,parent_id FROM public.folders WHERE id=NEW.parent_id AND user_id=NEW.user_id
    UNION
    SELECT f.id,f.parent_id FROM public.folders f JOIN ancestors a ON f.id=a.parent_id WHERE f.user_id=NEW.user_id
   ) SELECT 1 FROM ancestors WHERE id=NEW.id
 )) THEN RAISE EXCEPTION 'A folder cannot contain itself or an ancestor' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.check_folder_ancestry() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER folders_check_ancestry BEFORE INSERT OR UPDATE OF parent_id,user_id,id ON public.folders
 FOR EACH ROW EXECUTE FUNCTION private.check_folder_ancestry();
NOTIFY pgrst, 'reload schema';
