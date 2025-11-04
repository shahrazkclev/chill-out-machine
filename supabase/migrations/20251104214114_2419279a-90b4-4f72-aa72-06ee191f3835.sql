-- Create table for storing drawing scenes
CREATE TABLE IF NOT EXISTS public.drawings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Untitled Drawing',
  scene_data JSONB NOT NULL,
  thumbnail_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.drawings ENABLE ROW LEVEL SECURITY;

-- Public can view all drawings (no auth needed)
CREATE POLICY "Anyone can view drawings"
  ON public.drawings
  FOR SELECT
  USING (true);

-- Public can create drawings (no auth needed)
CREATE POLICY "Anyone can create drawings"
  ON public.drawings
  FOR INSERT
  WITH CHECK (true);

-- Public can update drawings (no auth needed)
CREATE POLICY "Anyone can update drawings"
  ON public.drawings
  FOR UPDATE
  USING (true);

-- Public can delete drawings (no auth needed)
CREATE POLICY "Anyone can delete drawings"
  ON public.drawings
  FOR DELETE
  USING (true);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
DROP TRIGGER IF EXISTS update_drawings_updated_at ON public.drawings;
CREATE TRIGGER update_drawings_updated_at
  BEFORE UPDATE ON public.drawings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for drawing images/exports
INSERT INTO storage.buckets (id, name, public)
VALUES ('drawings', 'drawings', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for drawing files
CREATE POLICY "Anyone can upload drawing files"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'drawings');

CREATE POLICY "Anyone can view drawing files"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'drawings');

CREATE POLICY "Anyone can update drawing files"
  ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'drawings');

CREATE POLICY "Anyone can delete drawing files"
  ON storage.objects
  FOR DELETE
  USING (bucket_id = 'drawings');