import Link from "next/link";

export default function AdministrationPage() {
  return <section className="space-y-4"><h1 className="text-3xl font-semibold">Statistics administration</h1>
    <p>Review access to the statistics administration tools.</p><Link className="text-emerald-600 underline" href="/stats/admin/users">Manage administrators</Link></section>;
}
