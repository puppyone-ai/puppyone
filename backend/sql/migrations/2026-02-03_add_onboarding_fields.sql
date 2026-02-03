-- Migration: Add onboarding tracking fields to profiles table
-- Description: Track user onboarding status to enable first-time user experience
--              including auto-created demo project
-- Date: 2026-02-03

-- ARCHITECTURE NOTE:
-- When a new user registers, we want to:
--   1. Detect that they're a first-time user (has_onboarded = false)
--   2. Auto-create a "Demo Project" with sample content
--   3. Mark onboarding as complete (has_onboarded = true)
--   4. Store the demo project ID for reference
--
-- This approach is better than checking "project count = 0" because:
--   - If user deletes all projects, they won't re-trigger onboarding
--   - We can manually reset has_onboarded for testing
--   - We can track exactly when onboarding was completed

DO $$
BEGIN
    RAISE NOTICE 'Starting migration to add onboarding fields to profiles...';

    -- Add has_onboarded field (default false for new users)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'profiles' 
        AND column_name = 'has_onboarded'
    ) THEN
        ALTER TABLE public.profiles 
        ADD COLUMN has_onboarded boolean NOT NULL DEFAULT false;
        RAISE NOTICE 'Added column: has_onboarded (boolean, default false)';
    ELSE
        RAISE NOTICE 'Column has_onboarded already exists, skipping.';
    END IF;

    -- Add onboarded_at timestamp (when onboarding was completed)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'profiles' 
        AND column_name = 'onboarded_at'
    ) THEN
        ALTER TABLE public.profiles 
        ADD COLUMN onboarded_at timestamp with time zone NULL;
        RAISE NOTICE 'Added column: onboarded_at (timestamp, nullable)';
    ELSE
        RAISE NOTICE 'Column onboarded_at already exists, skipping.';
    END IF;

    -- Add demo_project_id (reference to the auto-created demo project)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'profiles' 
        AND column_name = 'demo_project_id'
    ) THEN
        ALTER TABLE public.profiles 
        ADD COLUMN demo_project_id bigint NULL;
        RAISE NOTICE 'Added column: demo_project_id (bigint, nullable)';
    ELSE
        RAISE NOTICE 'Column demo_project_id already exists, skipping.';
    END IF;

    -- Set all existing users as already onboarded (they've been using the product)
    UPDATE public.profiles 
    SET has_onboarded = true, 
        onboarded_at = created_at  -- Use their registration time as onboarded time
    WHERE has_onboarded = false;
    
    RAISE NOTICE 'Marked all existing users as onboarded.';

    RAISE NOTICE 'Migration completed successfully.';
END;
$$;

-- Create index for quick lookup of non-onboarded users (useful for analytics)
CREATE INDEX IF NOT EXISTS idx_profiles_has_onboarded 
ON public.profiles (has_onboarded) 
WHERE has_onboarded = false;

-- Verification query (run this to check the new columns)
-- SELECT user_id, email, has_onboarded, onboarded_at, demo_project_id FROM public.profiles LIMIT 10;

