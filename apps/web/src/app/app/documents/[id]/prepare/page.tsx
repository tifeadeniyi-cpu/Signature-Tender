import { redirect } from 'next/navigation';

export default async function PrepareIndex({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/app/documents/${(await params).id}/prepare/review`);
}
