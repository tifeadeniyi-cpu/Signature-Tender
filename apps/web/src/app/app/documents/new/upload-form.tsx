'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud, FileText, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { TextField, SelectField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';

export function UploadForm({
  maxMb,
  types,
  selfSign = false,
}: {
  maxMb: number;
  types: { value: string; label: string }[];
  /** "Sign it yourself": adds you as the only signer and goes straight to placing fields. */
  selfSign?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  function choose(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf'))
      return setError('Only PDF files can be uploaded.');
    if (f.size > maxMb * 1024 * 1024) return setError(`The file is larger than ${maxMb} MB.`);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.pdf$/i, '').slice(0, 200));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError('Choose a PDF to upload.');
    if (!title.trim()) return setError('Document name is required.');
    if (!documentType) return setError('Choose a document type.');
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set('file', file);
    fd.set('title', title);
    fd.set('documentType', documentType);
    try {
      if (selfSign) fd.append('selfSign', '1');
      const res = await fetch('/api/documents', { method: 'POST', body: fd });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? 'Upload failed. Please try again.');
      router.push(`/app/documents/${body.id}/prepare/${selfSign ? 'fields' : 'signers'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            choose(e.dataTransfer.files[0]);
          }}
          className={cn(
            'flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors',
            drag ? 'border-primary bg-primary-surface' : 'border-border bg-ivory',
          )}
        >
          {file ? (
            <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-card">
              <FileText className="size-5 text-primary" aria-hidden />
              <div className="text-left">
                <p className="text-sm font-semibold text-heading">{file.name}</p>
                <p className="text-xs">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="rounded p-1 hover:bg-blush"
                aria-label="Remove file"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ) : (
            <>
              <UploadCloud className="size-10 text-primary" aria-hidden />
              <p className="font-semibold text-heading">Drag and drop your PDF here</p>
              <p className="text-sm">PDF only, up to {maxMb} MB</p>
            </>
          )}
          <Button type="button" variant="secondary" onClick={() => input.current?.click()}>
            {file ? 'Choose a different file' : 'Browse files'}
          </Button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            aria-label="PDF file"
            onChange={(e) => choose(e.target.files?.[0])}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Document name"
            required
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
          <SelectField
            label="Document type"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
          >
            <option value="">Select type</option>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </SelectField>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            Upload and continue
          </Button>
        </div>
      </form>
    </Card>
  );
}
