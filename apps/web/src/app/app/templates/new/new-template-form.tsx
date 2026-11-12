'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { TextField, SelectField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';

export function NewTemplateForm({
  maxMb,
  types,
  categories,
}: {
  maxMb: number;
  types: { value: string; label: string }[];
  categories: string[];
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function choose(f: File | undefined) {
    setError(null);
    setFile(null);
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf'))
      return setError('Only PDF files can be uploaded.');
    if (f.size > maxMb * 1024 * 1024) return setError(`The file is larger than ${maxMb} MB.`);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.pdf$/i, '').slice(0, 200));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!file) return setError('Choose a PDF to upload.');
    if (!title.trim()) return setError('Template name is required.');
    if (!form.get('category')) return setError('Choose a category.');
    if (!form.get('documentType')) return setError('Choose a document type.');
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set('file', file);
    fd.set('title', title);
    fd.set('description', String(form.get('description') ?? ''));
    fd.set('category', String(form.get('category')));
    fd.set('documentType', String(form.get('documentType')));
    fd.set('shared', form.get('shared') === 'on' ? 'true' : 'false');
    try {
      const res = await fetch('/api/templates', { method: 'POST', body: fd });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? 'Upload failed. Please try again.');
      router.push(`/app/templates/${body.id}/roles`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <Card>
      <form
        onSubmit={submit}
        className="flex flex-col gap-5"
        noValidate
        aria-label="Create template"
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium text-heading">
          PDF file
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => choose(e.target.files?.[0])}
            className="rounded-lg border border-dashed border-border bg-ivory p-4 text-sm font-normal"
          />
          <span className="text-xs font-normal">PDF only, up to {maxMb} MB.</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Template name"
            required
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
          <SelectField label="Category" name="category" defaultValue="">
            <option value="">Select category</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
          <SelectField label="Document type" name="documentType" defaultValue="">
            <option value="">Select type</option>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </SelectField>
          <TextField label="Description (optional)" name="description" maxLength={500} />
        </div>
        <label className="flex items-center gap-2 text-sm text-heading">
          <input type="checkbox" name="shared" defaultChecked className="size-4" />
          Share with everyone in the workspace who can use templates
        </label>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            Upload and add roles
          </Button>
        </div>
      </form>
    </Card>
  );
}
