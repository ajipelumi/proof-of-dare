;; Proof of Dare - Clarity smart contract

(define-constant ERR_UNAUTHORIZED u100)
(define-constant ERR_INVALID_STAKE u101)
(define-constant ERR_CHALLENGE_NOT_FOUND u102)
(define-constant ERR_CHALLENGE_EXPIRED u103)
(define-constant ERR_CHALLENGE_ALREADY_ACCEPTED u104)
(define-constant ERR_INSUFFICIENT_FUNDS u105)
(define-constant ERR_VOTING_NOT_ACTIVE u106)
(define-constant ERR_ALREADY_VOTED u107)
(define-constant ERR_INVALID_VOTE u108)
(define-constant ERR_REVEAL_PERIOD_ENDED u109)
(define-constant ERR_CHALLENGE_NOT_RESOLVED u110)
(define-constant ERR_SELF_CHALLENGE u111)

(define-constant STATUS_PENDING u0)
(define-constant STATUS_ACTIVE u1)
(define-constant STATUS_VOTING u2)
(define-constant STATUS_RESOLVED u3)
(define-constant STATUS_EXPIRED u4)

(define-constant TYPE_TRUTH u0)
(define-constant TYPE_DARE u1)

(define-constant MIN_STAKE u1000000) ;; 1 STX in microSTX

;; Time windows in blocks (~10 min per block on Stacks test settings)
(define-constant ACCEPT_WINDOW u144)
(define-constant COMMIT_WINDOW u144)
(define-constant REVEAL_WINDOW u144)

(define-data-var next-id uint u1)

(define-map challenges uint
  {
    challenger: principal,
    challengee: principal,
    stake: uint,
    challenge-type: uint,
    description: (string-ascii 500),
    status: uint,
    created-at: uint,
    accepted-at: (optional uint),
    voting-start: (optional uint),
    total-votes: uint,
    completed-votes: uint,
    not-completed-votes: uint
  }
)

;; commit: map (challenge-id, voter) -> commit-hash
(define-map vote-commit {
  id: uint,
  voter: principal
} (buff 32))

;; revealed: map (challenge-id, voter) -> u1 (1 completed, 2 not)
(define-map vote-reveal {
  id: uint,
  voter: principal
} uint)

;; Simple non-transferable reputation points and badge minting
(define-map reputation principal uint)
(define-map badges uint principal) ;; badge-id -> owner
(define-data-var next-badge-id uint u1)

(define-read-only (get-challenge (id uint))
  (match (map-get? challenges id)
    challenge (ok challenge)
    (err ERR_CHALLENGE_NOT_FOUND)
  )
)

(define-read-only (get-user-reputation (user principal))
  (ok (default-to u0 (map-get? reputation user)))
)

(define-read-only (get-vote-commit (id uint) (voter principal))
  (ok (map-get? vote-commit { id: id, voter: voter }))
)

(define-read-only (get-vote-reveal (id uint) (voter principal))
  (ok (map-get? vote-reveal { id: id, voter: voter }))
)

(define-private (vote->buff (v uint))
  (if (is-eq v u1) 0x01 0x02)
)

(define-read-only (make-commit (vote uint) (nonce (buff 32)) (voter principal))
  ;; Simplified commit: sha256( vote-byte || nonce )
  (sha256 (concat (vote->buff vote) nonce))
)

(define-private (increase-rep (user principal) (amount uint))
  (match (map-get? reputation user)
    current (map-set reputation user (+ current amount))
    (map-set reputation user amount)
  )
)

(define-public (create-challenge (challengee principal) (challenge-type uint) (description (string-ascii 500)) (stake uint))
  (begin
    (asserts! (not (is-eq tx-sender challengee)) (err ERR_SELF_CHALLENGE))
    (asserts! (>= stake MIN_STAKE) (err ERR_INVALID_STAKE))
    (asserts! (or (is-eq challenge-type TYPE_TRUTH) (is-eq challenge-type TYPE_DARE)) (err ERR_INVALID_STAKE))
    (asserts! (> (len description) u0) (err ERR_INVALID_STAKE))
    (let (
      (id (var-get next-id))
      (sender tx-sender)
    )
      (try! (stx-transfer? stake sender (as-contract tx-sender)))
      (map-set challenges id {
        challenger: sender,
        challengee: challengee,
        stake: stake,
        challenge-type: challenge-type,
        description: description,
        status: STATUS_PENDING,
        created-at: burn-block-height,
        accepted-at: none,
        voting-start: none,
        total-votes: u0,
        completed-votes: u0,
        not-completed-votes: u0
      })
      (var-set next-id (+ id u1))
      (increase-rep sender u10)
      (ok id)
    )
  )
)

(define-public (accept-challenge (id uint))
  (let ((maybe (map-get? challenges id)))
    (match maybe
      challenge
      (begin
        (asserts! (is-some maybe) (err ERR_CHALLENGE_NOT_FOUND))
        (asserts! (is-eq tx-sender (get challengee challenge)) (err ERR_UNAUTHORIZED))
        (asserts! (is-eq (get status challenge) STATUS_PENDING) (err ERR_CHALLENGE_ALREADY_ACCEPTED))
        (let (
          (expired (> (- burn-block-height (get created-at challenge)) ACCEPT_WINDOW))
        )
          (asserts! (not expired) (err ERR_CHALLENGE_EXPIRED))
          (try! (stx-transfer? (get stake challenge) tx-sender (as-contract tx-sender)))
          (map-set challenges id (merge challenge { status: STATUS_ACTIVE, accepted-at: (some burn-block-height) }))
          (ok true)
        )
      )
      (err ERR_CHALLENGE_NOT_FOUND)
    )
  )
)

(define-public (start-voting (id uint))
  (let ((maybe (map-get? challenges id)))
    (match maybe
      challenge
      (begin
        (asserts! (is-some maybe) (err ERR_CHALLENGE_NOT_FOUND))
        (asserts! (or (is-eq tx-sender (get challenger challenge)) (is-eq tx-sender (get challengee challenge))) (err ERR_UNAUTHORIZED))
        (asserts! (is-eq (get status challenge) STATUS_ACTIVE) (err ERR_VOTING_NOT_ACTIVE))
        (map-set challenges id (merge challenge { status: STATUS_VOTING, voting-start: (some burn-block-height) }))
        (ok true)
      )
      (err ERR_CHALLENGE_NOT_FOUND)
    )
  )
)

(define-public (commit-vote (id uint) (commit (buff 32)))
  (let ((maybe (map-get? challenges id)))
    (match maybe
      challenge
      (begin
        (asserts! (is-some maybe) (err ERR_CHALLENGE_NOT_FOUND))
        (asserts! (not (or (is-eq tx-sender (get challenger challenge)) (is-eq tx-sender (get challengee challenge)))) (err ERR_UNAUTHORIZED))
        (asserts! (is-eq (get status challenge) STATUS_VOTING) (err ERR_VOTING_NOT_ACTIVE))
        (asserts! (is-eq (len commit) u32) (err ERR_INVALID_VOTE))
        (let ((start (unwrap-panic (get voting-start challenge))))
          (asserts! (<= burn-block-height (+ start COMMIT_WINDOW)) (err ERR_REVEAL_PERIOD_ENDED))
          (asserts! (is-none (map-get? vote-commit { id: id, voter: tx-sender })) (err ERR_ALREADY_VOTED))
          (map-set vote-commit { id: id, voter: tx-sender } commit)
          (increase-rep tx-sender u5)
          (ok true)
        )
      )
      (err ERR_CHALLENGE_NOT_FOUND)
    )
  )
)

(define-public (reveal-vote (id uint) (vote uint) (nonce (buff 32)))
  (let ((maybe (map-get? challenges id)))
    (match maybe
      challenge
      (begin
        (asserts! (is-some maybe) (err ERR_CHALLENGE_NOT_FOUND))
        (asserts! (not (or (is-eq tx-sender (get challenger challenge)) (is-eq tx-sender (get challengee challenge)))) (err ERR_UNAUTHORIZED))
        (asserts! (is-eq (get status challenge) STATUS_VOTING) (err ERR_VOTING_NOT_ACTIVE))
        (let ((start (unwrap-panic (get voting-start challenge))))
          (asserts! (and (> burn-block-height start) (<= burn-block-height (+ start (+ COMMIT_WINDOW REVEAL_WINDOW)))) (err ERR_REVEAL_PERIOD_ENDED))
          (asserts! (or (is-eq vote u1) (is-eq vote u2)) (err ERR_INVALID_VOTE))
          (let ((committed (map-get? vote-commit { id: id, voter: tx-sender })))
            (match committed
              the-commit
              (let ((expected (sha256 (concat (vote->buff vote) nonce))))
                (asserts! (is-eq the-commit expected) (err ERR_INVALID_VOTE))
                (asserts! (is-none (map-get? vote-reveal { id: id, voter: tx-sender })) (err ERR_ALREADY_VOTED))
                (map-set vote-reveal { id: id, voter: tx-sender } vote)
                (map-set challenges id (merge challenge {
                  total-votes: (+ (get total-votes challenge) u1),
                  completed-votes: (+ (get completed-votes challenge) (if (is-eq vote u1) u1 u0)),
                  not-completed-votes: (+ (get not-completed-votes challenge) (if (is-eq vote u2) u1 u0))
                }))
                (ok true)
              )
              (err ERR_INVALID_VOTE)
            )
          )
        )
      )
      (err ERR_CHALLENGE_NOT_FOUND)
    )
  )
)

(define-public (resolve-challenge (id uint))
  (let ((maybe (map-get? challenges id)))
    (match maybe
      challenge
      (begin
        (asserts! (is-some maybe) (err ERR_CHALLENGE_NOT_FOUND))
        (let ((start (unwrap-panic (get voting-start challenge))))
          (asserts! (is-eq (get status challenge) STATUS_VOTING) (err ERR_CHALLENGE_NOT_RESOLVED))
          (asserts! (> burn-block-height (+ start (+ COMMIT_WINDOW REVEAL_WINDOW))) (err ERR_REVEAL_PERIOD_ENDED))
          (let (
            (stake (get stake challenge))
            (challenger (get challenger challenge))
            (challengee (get challengee challenge))
            (completed (get completed-votes challenge))
            (not-completed (get not-completed-votes challenge))
          )
            (if (> completed not-completed)
              (begin
                (try! (as-contract (stx-transfer? (+ stake stake) tx-sender challengee)))
                (increase-rep challengee u50)
                (map-set challenges id (merge challenge { status: STATUS_RESOLVED }))
                (ok challengee)
              )
              (if (> not-completed completed)
                (begin
                  (try! (as-contract (stx-transfer? (+ stake stake) tx-sender challenger)))
                  (increase-rep challenger u50)
                  (map-set challenges id (merge challenge { status: STATUS_RESOLVED }))
                  (ok challenger)
                )
                (begin
                  (try! (as-contract (stx-transfer? stake tx-sender challenger)))
                  (try! (as-contract (stx-transfer? stake tx-sender challengee)))
                  (map-set challenges id (merge challenge { status: STATUS_RESOLVED }))
                  (ok (as-contract tx-sender))
                )
              )
            )
          )
        )
      )
      (err ERR_CHALLENGE_NOT_FOUND)
    )
  )
)

(define-public (refund-expired-challenge (id uint))
  (let ((maybe (map-get? challenges id)))
    (match maybe
      challenge
      (begin
        (asserts! (is-some maybe) (err ERR_CHALLENGE_NOT_FOUND))
        (asserts! (is-eq tx-sender (get challenger challenge)) (err ERR_UNAUTHORIZED))
        (asserts! (is-eq (get status challenge) STATUS_PENDING) (err ERR_CHALLENGE_ALREADY_ACCEPTED))
        (let ((expired (> (- burn-block-height (get created-at challenge)) ACCEPT_WINDOW)))
          (asserts! expired (err ERR_CHALLENGE_EXPIRED))
          (try! (as-contract (stx-transfer? (get stake challenge) tx-sender (get challenger challenge))))
          (map-set challenges id (merge challenge { status: STATUS_EXPIRED }))
          (ok true)
        )
      )
      (err ERR_CHALLENGE_NOT_FOUND)
    )
  )
)

(define-public (mint-reputation-badge (recipient principal))
  (let ((rep (default-to u0 (map-get? reputation recipient))))
    (asserts! (>= rep u100) (err ERR_UNAUTHORIZED))
    (let ((id (var-get next-badge-id)))
      (map-set badges id recipient)
      (var-set next-badge-id (+ id u1))
      (ok id)
    )
  )
)
