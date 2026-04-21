-- Add ecnSku column to ProductMatch table for ECN / Adult Drop Shipper integration
-- Run this against your Supabase database before deploying the ECN update
-- Supabase project: vasocjpfrzwmriakuuhu

ALTER TABLE "ProductMatch" ADD COLUMN IF NOT EXISTS "ecnSku" TEXT;
