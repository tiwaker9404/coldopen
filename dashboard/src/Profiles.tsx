import { Privacy } from './Account.tsx'
import type { Me, Profile } from './api.ts'
import { Tools } from './Guide.tsx'

/**
 * Everything about you, on one page: the profiles your films are made from (one per kind of
 * role you apply for), then the tools coldopen connects to.
 */
export function ProfilesPage({
  me,
  profiles,
  onEdit,
  onNew,
}: {
  me: Me | undefined
  profiles: Profile[]
  onEdit: (p: Profile) => void
  onNew: () => void
}) {
  return (
    <div className="page-body">
      <section className="section" aria-labelledby="profiles-title">
        <div className="section-head">
          <div>
            <h2 id="profiles-title">Your profiles</h2>
            <p className="section-sub">
              What your films say about you. Keep one per kind of role, like one for engineering
              jobs and one for solutions roles, and pick which to use when you make a film.
            </p>
          </div>
          <button type="button" className="primary" onClick={onNew}>
            New profile
          </button>
        </div>
        {profiles.length === 0 ? (
          <p className="empty">No profile yet. Make one from your résumé in about a minute.</p>
        ) : (
          <ul className="profile-list">
            {profiles.map((p, i) => (
              <li key={p.id}>
                <div className="profile-card">
                  <div>
                    <b>
                      {p.name}
                      {i === 0 && <span className="pill">Used by default</span>}
                    </b>
                    <span>
                      {[p.data.sender.name, p.data.sender.role, p.data.sender.company]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                    <p>{p.data.offer}</p>
                    <small>
                      {p.data.proof.length} results, {p.data.points.length} strengths
                      {p.data.cta.book ? ', booking link set' : ', no booking link yet'}
                    </small>
                  </div>
                  <button type="button" onClick={() => onEdit(p)}>
                    Edit profile
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="tools-title">
        <div className="section-head">
          <div>
            <h2 id="tools-title">Connected tools</h2>
            <p className="section-sub">
              Optional extras that make sending faster. Everything works without them.
            </p>
          </div>
        </div>
        <Tools me={me} />
      </section>

      {me && <Privacy me={me} />}
    </div>
  )
}
