'use client';

import { useState, useMemo } from 'react';
import { ArrowLeft, Zap, TrendingDown, DollarSign } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface YearProjection {
  year: number;
  utilityMonthly: number;
  utilityYearly: number;
  leaseMonthly: number;
  leaseYearly: number;
}

export default function SolarCalculatorPage() {
  const router = useRouter();
  const [currentElectric, setCurrentElectric] = useState(180);
  const [solarPayment, setSolarPayment] = useState(140);
  const [leftoverBill, setLeftoverBill] = useState(30);

  const UTILITY_RATE_INCREASE = 0.075; // 7.5%
  const LEASE_RATE_INCREASE = 0.0299; // 2.99%

  const projections = useMemo(() => {
    const results: YearProjection[] = [];
    
    let utilityMonthly = currentElectric;
    let leaseMonthly = solarPayment + leftoverBill;

    for (let year = 1; year <= 25; year++) {
      results.push({
        year,
        utilityMonthly,
        utilityYearly: utilityMonthly * 12,
        leaseMonthly,
        leaseYearly: leaseMonthly * 12,
      });

      // Apply rate increases for next year
      utilityMonthly *= (1 + UTILITY_RATE_INCREASE);
      leaseMonthly *= (1 + LEASE_RATE_INCREASE);
    }

    return results;
  }, [currentElectric, solarPayment, leftoverBill]);

  const tenYearUtility = projections.slice(0, 10).reduce((sum, p) => sum + p.utilityYearly, 0);
  const tenYearLease = projections.slice(0, 10).reduce((sum, p) => sum + p.leaseYearly, 0);
  const tenYearSavings = tenYearUtility - tenYearLease;

  const twentyFiveYearUtility = projections.reduce((sum, p) => sum + p.utilityYearly, 0);
  const twentyFiveYearLease = projections.reduce((sum, p) => sum + p.leaseYearly, 0);
  const twentyFiveYearSavings = twentyFiveYearUtility - twentyFiveYearLease;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F7FAFC] to-[#EDF2F7]">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0] sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-[#4299E1] hover:text-[#3182CE] mb-3"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-[#FF5F5A] to-[#F27141] rounded-xl flex items-center justify-center shadow-md">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[#2D3748]">Solar Lease Calculator</h1>
              <p className="text-[#718096]">Compare your utility costs vs solar lease over 25 years</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Input Section */}
        <div className="bg-white rounded-xl shadow-lg p-6 lg:p-8 mb-8">
          <h2 className="text-2xl font-bold text-[#2D3748] mb-6">Your Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Current Electric Payment */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Current Electric Payment
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#718096]">$</span>
                <input
                  type="number"
                  value={currentElectric}
                  onChange={(e) => setCurrentElectric(Number(e.target.value))}
                  className="w-full pl-8 pr-4 py-3 border-2 border-[#E2E8F0] rounded-lg text-lg font-semibold focus:border-[#FF5F5A] focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#718096]">/month</span>
              </div>
            </div>

            {/* Solar Payment */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Solar Lease Payment
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#718096]">$</span>
                <input
                  type="number"
                  value={solarPayment}
                  onChange={(e) => setSolarPayment(Number(e.target.value))}
                  className="w-full pl-8 pr-4 py-3 border-2 border-[#E2E8F0] rounded-lg text-lg font-semibold focus:border-[#FF5F5A] focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#718096]">/month</span>
              </div>
            </div>

            {/* Leftover Bill */}
            <div>
              <label className="block text-sm font-semibold text-[#2D3748] mb-2">
                Leftover Utility Bill
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#718096]">$</span>
                <input
                  type="number"
                  value={leftoverBill}
                  onChange={(e) => setLeftoverBill(Number(e.target.value))}
                  className="w-full pl-8 pr-4 py-3 border-2 border-[#E2E8F0] rounded-lg text-lg font-semibold focus:border-[#FF5F5A] focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#718096]">/month</span>
              </div>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* 10 Year Projection */}
          <div className="bg-gradient-to-br from-[#4299E1] to-[#3182CE] rounded-xl shadow-lg p-6 text-white">
            <div className="flex items-center gap-3 mb-4">
              <DollarSign className="w-8 h-8" />
              <h3 className="text-2xl font-bold">10-Year Projection</h3>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-white/80">Utility Costs:</span>
                <span className="text-2xl font-bold">{formatCurrency(tenYearUtility)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/80">Solar Lease:</span>
                <span className="text-2xl font-bold">{formatCurrency(tenYearLease)}</span>
              </div>
              <div className="h-px bg-white/20 my-2" />
              <div className="flex justify-between items-center">
                <span className="text-xl font-semibold">Your Savings:</span>
                <span className="text-3xl font-bold text-[#48BB78]">{formatCurrency(tenYearSavings)}</span>
              </div>
            </div>
          </div>

          {/* 25 Year Projection */}
          <div className="bg-gradient-to-br from-[#FF5F5A] to-[#F27141] rounded-xl shadow-lg p-6 text-white">
            <div className="flex items-center gap-3 mb-4">
              <TrendingDown className="w-8 h-8" />
              <h3 className="text-2xl font-bold">25-Year Projection</h3>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-white/80">Utility Costs:</span>
                <span className="text-2xl font-bold">{formatCurrency(twentyFiveYearUtility)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/80">Solar Lease:</span>
                <span className="text-2xl font-bold">{formatCurrency(twentyFiveYearLease)}</span>
              </div>
              <div className="h-px bg-white/20 my-2" />
              <div className="flex justify-between items-center">
                <span className="text-xl font-semibold">Your Savings:</span>
                <span className="text-3xl font-bold text-[#F6E05E]">{formatCurrency(twentyFiveYearSavings)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Year-by-Year Breakdown */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-[#2D3748] to-[#1A202C] p-6">
            <h3 className="text-2xl font-bold text-white">Year-by-Year Breakdown</h3>
            <p className="text-white/80 mt-1">Utility increases at 7.5%/year | Solar lease increases at 2.99%/year</p>
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#F7FAFC]">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-[#2D3748]">Year</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-[#2D3748]">Utility (Monthly)</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-[#2D3748]">Utility (Yearly)</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-[#2D3748]">Lease (Monthly)</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-[#2D3748]">Lease (Yearly)</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-[#48BB78]">Annual Savings</th>
                </tr>
              </thead>
              <tbody>
                {projections.map((p, idx) => (
                  <tr key={p.year} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#F7FAFC]'}>
                    <td className="px-6 py-4 text-sm font-semibold text-[#2D3748]">{p.year}</td>
                    <td className="px-6 py-4 text-sm text-right text-[#718096]">{formatCurrency(p.utilityMonthly)}</td>
                    <td className="px-6 py-4 text-sm text-right font-semibold text-[#2D3748]">{formatCurrency(p.utilityYearly)}</td>
                    <td className="px-6 py-4 text-sm text-right text-[#718096]">{formatCurrency(p.leaseMonthly)}</td>
                    <td className="px-6 py-4 text-sm text-right font-semibold text-[#2D3748]">{formatCurrency(p.leaseYearly)}</td>
                    <td className="px-6 py-4 text-sm text-right font-bold text-[#48BB78]">
                      {formatCurrency(p.utilityYearly - p.leaseYearly)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-[#E2E8F0]">
            {projections.map((p) => (
              <div key={p.year} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-lg font-bold text-[#2D3748]">Year {p.year}</span>
                  <span className="px-3 py-1 bg-[#48BB78] text-white text-sm font-bold rounded-full">
                    Save {formatCurrency(p.utilityYearly - p.leaseYearly)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-[#718096] mb-1">Utility</p>
                    <p className="text-sm font-semibold text-[#2D3748]">{formatCurrency(p.utilityMonthly)}/mo</p>
                    <p className="text-xs text-[#718096]">{formatCurrency(p.utilityYearly)}/year</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#718096] mb-1">Solar Lease</p>
                    <p className="text-sm font-semibold text-[#2D3748]">{formatCurrency(p.leaseMonthly)}/mo</p>
                    <p className="text-xs text-[#718096]">{formatCurrency(p.leaseYearly)}/year</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Terms Info */}
        <div className="mt-8 bg-gradient-to-br from-[#EDF2F7] to-white rounded-xl p-6 border-2 border-[#E2E8F0]">
          <h4 className="text-lg font-bold text-[#2D3748] mb-3">Lease Benefits</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-[#48BB78] rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-white text-xs">✓</span>
              </div>
              <div>
                <p className="font-semibold text-[#2D3748]">25-Year Term</p>
                <p className="text-sm text-[#718096]">Fixed rate protection for the full term</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-[#48BB78] rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-white text-xs">✓</span>
              </div>
              <div>
                <p className="font-semibold text-[#2D3748]">25% Tax Credit</p>
                <p className="text-sm text-[#718096]">Up to $5,000 back from IRS</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-[#48BB78] rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-white text-xs">✓</span>
              </div>
              <div>
                <p className="font-semibold text-[#2D3748]">25-Year Warranty</p>
                <p className="text-sm text-[#718096]">Full system coverage included</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-[#48BB78] rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-white text-xs">✓</span>
              </div>
              <div>
                <p className="font-semibold text-[#2D3748]">Rate Lock</p>
                <p className="text-sm text-[#718096]">Protected from utility rate spikes</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
