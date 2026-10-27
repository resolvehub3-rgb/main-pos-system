import {COMPARISON_ROWS, PACKAGES} from '../config/pricing';
import {Reveal} from './Reveal';

export default function Comparison() {
  return (
    <section className="bg-slate-50 pb-20 pt-4 lg:pb-28" aria-labelledby="comparison-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-3xl">
          <h2
            id="comparison-heading"
            className="text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl"
          >
            Compare packages and licence terms
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            Features marked <em>To be confirmed</em> exist in SamTill but their assignment to each
            package has not yet been finalised.
          </p>
        </Reveal>

        <Reveal delayMs={80}>
          <div
            className="mt-10 overflow-x-auto rounded-2xl border border-slate-200 bg-white"
            role="region"
            aria-label="Package comparison table"
            tabIndex={0}
          >
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <caption className="sr-only">
                Comparison of the Starter, Business and Professional SamTill packages
              </caption>
              <thead>
                <tr className="border-b border-slate-200 bg-navy-900">
                  <th scope="col" className="px-5 py-4 font-bold text-white">
                    Feature
                  </th>
                  {PACKAGES.map((pkg) => (
                    <th
                      key={pkg.id}
                      scope="col"
                      className={`px-5 py-4 font-bold ${
                        pkg.highlighted ? 'bg-navy-800 text-amber-400' : 'text-white'
                      }`}
                    >
                      {pkg.name}
                      <span className="mt-0.5 block text-xs font-semibold text-navy-200">
                        {pkg.currency}
                        {pkg.price.toLocaleString('en-GH')}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, index) => (
                  <tr
                    key={row.feature}
                    className={index % 2 === 1 ? 'bg-slate-50' : 'bg-white'}
                  >
                    <th scope="row" className="px-5 py-4 font-semibold text-navy-900">
                      {row.feature}
                      {row.detail && (
                        <span className="block text-xs font-normal text-slate-500">{row.detail}</span>
                      )}
                    </th>
                    {row.values.map((value, valueIndex) => (
                      <td
                        key={`${row.feature}-${valueIndex}`}
                        className={`px-5 py-4 ${
                          row.ownerReview
                            ? 'font-medium text-slate-500'
                            : value === 'Included'
                              ? 'font-semibold text-navy-900'
                              : 'text-slate-700'
                        }`}
                      >
                        {value === 'Included' && (
                          <span className="inline-flex items-center gap-1.5">
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 20 20"
                              width="16"
                              height="16"
                              fill="currentColor"
                              className="text-amber-600"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                                clipRule="evenodd"
                              />
                            </svg>
                            Included
                          </span>
                        )}
                        {value !== 'Included' && value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <p className="mt-4 text-xs text-slate-500">
          Every package is a one-time licence for one computer. Comparison contents are draft and
          may change with the owner's final package definitions.
        </p>
      </div>
    </section>
  );
}
