type StatCardProps = {
  icon: string;
  value: string;
  label: string;
};

export default function StatCard({
  icon,
  value,
  label,
}: StatCardProps) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
      <span className="text-3xl">{icon}</span>

      <h3 className="text-3xl font-black mt-4">
        {value}
      </h3>

      <p className="text-white/50 text-sm">
        {label}
      </p>
    </div>
  );
}