/* Braces & Beyond — booking calendar and forms.
 *
 * Mounts into any element carrying data-bb-booking or data-bb-enquiry.
 * No dependencies, no build step. Everything talks to the plugin REST API.
 */
(function () {
	'use strict';

	var C = window.BBB_CFG || {};
	if (!C.rest) { return; }

	var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	/* ------------------------------------------------------------------ *
	 * small helpers
	 * ------------------------------------------------------------------ */

	function pad(n) { return (n < 10 ? '0' : '') + n; }

	function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

	function esc(s) {
		return String(s == null ? '' : s)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	}

	function api(path, opts) {
		opts = opts || {};
		var init = {
			method: opts.method || 'GET',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' }
		};
		if (C.nonce) { init.headers['X-WP-Nonce'] = C.nonce; }
		if (opts.body) { init.body = JSON.stringify(opts.body); }

		return fetch(C.rest + path, init).then(function (res) {
			return res.text().then(function (raw) {
				var json = {};
				try { json = raw ? JSON.parse(raw) : {}; } catch (e) { json = {}; }
				if (!res.ok) {
					var err = new Error(json.message || 'We could not reach the clinic calendar. Please try again.');
					err.code = json.code || '';
					err.status = res.status;
					err.field = (json.data && json.data.field) || '';
					throw err;
				}
				return json;
			});
		});
	}

	/* ------------------------------------------------------------------ *
	 * booking widget
	 * ------------------------------------------------------------------ */

	function mountBooking(root) {

		if (root.getAttribute('data-bbb-ready')) { return; }
		root.setAttribute('data-bbb-ready', '1');

		var title = root.getAttribute('data-bb-title') || 'Book a Consultation';

		var state = {
			month: (C.startMonth || ymd(new Date()).slice(0, 7)),
			monthData: null,
			date: null,
			day: null,
			time: null,
			opened: Date.now(),
			busy: false
		};

		root.className = ((root.className || '') + ' bbb').trim();
		root.innerHTML = shell(title);

		var el = {
			steps: root.querySelector('[data-bbb="steps"]'),
			month: root.querySelector('[data-bbb="month"]'),
			prev: root.querySelector('[data-bbb="prev"]'),
			next: root.querySelector('[data-bbb="next"]'),
			grid: root.querySelector('[data-bbb="grid"]'),
			slots: root.querySelector('[data-bbb="slots"]'),
			form: root.querySelector('[data-bbb="form"]'),
			body: root.querySelector('[data-bbb="body"]'),
			done: root.querySelector('[data-bbb="done"]'),
			alert: root.querySelector('[data-bbb="alert"]')
		};

		el.prev.addEventListener('click', function () { shiftMonth(-1); });
		el.next.addEventListener('click', function () { shiftMonth(1); });

		loadMonth(state.month);
		paintSteps();

		/* ---- month ---- */

		function shiftMonth(delta) {
			var parts = state.month.split('-');
			var d = new Date(+parts[0], +parts[1] - 1 + delta, 1);
			loadMonth(d.getFullYear() + '-' + pad(d.getMonth() + 1));
		}

		function loadMonth(ym) {
			el.grid.innerHTML = '<div class="bbb-loading" style="grid-column:1/-1"><span class="bbb-spin"></span> Loading available dates…</div>';
			api('/month?month=' + encodeURIComponent(ym)).then(function (data) {
				state.month = data.month;
				state.monthData = data;
				paintMonth();
			}).catch(function (e) {
				el.grid.innerHTML = '<p style="grid-column:1/-1" class="bbb-note">' + esc(e.message) + '</p>';
			});
		}

		function paintMonth() {
			var data = state.monthData;
			el.month.textContent = data.label;

			var first = new Date(+data.month.split('-')[0], +data.month.split('-')[1] - 1, 1);
			var lead = (first.getDay() + 6) % 7; // grid starts on Monday
			var daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
			var todayKey = data.min;

			var html = '';
			for (var i = 0; i < lead; i++) { html += '<span class="bbb-day is-empty"></span>'; }

			for (var d = 1; d <= daysIn; d++) {
				var key = data.month + '-' + pad(d);
				var info = data.days[key] || { status: 'closed', free: 0 };
				var open = info.status === 'open';
				var cls = 'bbb-day';
				var note = '';

				if (info.status === 'full') { cls += ' is-full'; note = 'fully booked'; }
				else if (info.status === 'closed') { note = 'closed'; }
				else if (info.status === 'past') { note = 'past'; }
				else if (info.status === 'beyond') { note = 'not open yet'; }
				else { note = info.free + (info.free === 1 ? ' slot free' : ' slots free'); }

				if (key === todayKey) { cls += ' is-today'; }
				if (key === state.date) { cls += ' is-on'; }

				html += '<button type="button" class="' + cls + '" data-date="' + key + '"' +
					(open ? '' : ' disabled') +
					' aria-label="' + esc(d + ' ' + data.label + ', ' + note) + '"' +
					' aria-pressed="' + (key === state.date ? 'true' : 'false') + '">' +
					'<span>' + d + '</span>' +
					(open ? '<span class="bbb-dot"></span>' : '') +
					'</button>';
			}

			el.grid.innerHTML = html;

			// prev is blocked before the current month, next beyond the horizon
			el.prev.disabled = (data.month <= (C.startMonth || data.month));
			el.next.disabled = (data.month >= (C.maxMonth || data.month));

			Array.prototype.forEach.call(el.grid.querySelectorAll('[data-date]'), function (btn) {
				btn.addEventListener('click', function () { pickDate(btn.getAttribute('data-date')); });
			});
		}

		/* ---- slots ---- */

		function pickDate(date) {
			state.date = date;
			state.time = null;
			paintMonth();
			paintSteps();
			hideAlert();
			el.form.hidden = true;

			el.slots.hidden = false;
			el.slots.innerHTML = '<div class="bbb-loading"><span class="bbb-spin"></span> Checking what is free…</div>';

			api('/slots?date=' + encodeURIComponent(date)).then(function (day) {
				state.day = day;
				paintSlots(day);
			}).catch(function (e) {
				el.slots.innerHTML = '<p class="bbb-note">' + esc(e.message) + '</p>';
			});
		}

		function paintSlots(day) {
			if (!day.open || !day.slots.length) {
				el.slots.innerHTML = '<h3>' + esc(day.label || '') + '</h3><p class="bbb-slots-sub">' + esc(day.reason || 'No times are available on this day.') + '</p>';
				return;
			}

			var groups = { Morning: [], Afternoon: [], Evening: [] };
			day.slots.forEach(function (s) {
				var hour = parseInt(s.time.split(':')[0], 10);
				var key = hour < 12 ? 'Morning' : (hour < 17 ? 'Afternoon' : 'Evening');
				groups[key].push(s);
			});

			var html = '<h3>' + esc(day.label) + '</h3>' +
				'<p class="bbb-slots-sub">' + (day.available
					? esc(day.available + (day.available === 1 ? ' time still free' : ' times still free') + '. Each appointment is ' + (C.minutes || 30) + ' minutes.')
					: esc(day.reason || '')) + '</p>';

			Object.keys(groups).forEach(function (name) {
				if (!groups[name].length) { return; }
				html += '<div class="bbb-group"><p class="bbb-group-t">' + name + '</p><div class="bbb-times">';
				groups[name].forEach(function (s) {
					html += '<button type="button" class="bbb-time' + (s.time === state.time ? ' is-on' : '') + '"' +
						' data-time="' + s.time + '"' + (s.available ? '' : ' disabled') +
						' aria-pressed="' + (s.time === state.time ? 'true' : 'false') + '"' +
						' aria-label="' + esc(s.label + (s.available ? ', available' : (s.reason === 'full' ? ', fully booked' : ', no longer available'))) + '">' +
						esc(s.label) + '</button>';
				});
				html += '</div></div>';
			});

			el.slots.innerHTML = html;

			Array.prototype.forEach.call(el.slots.querySelectorAll('[data-time]'), function (btn) {
				btn.addEventListener('click', function () { pickTime(btn.getAttribute('data-time')); });
			});
		}

		function pickTime(time) {
			state.time = time;
			paintSlots(state.day);
			paintSteps();
			el.form.hidden = false;
			root.querySelector('[data-bbb="chosen"]').textContent = state.day.label + ' at ' + label(time);
			try { el.form.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* older browsers */ }
			var firstField = el.form.querySelector('input[name="name"]');
			if (firstField) { firstField.focus({ preventScroll: true }); }
		}

		function label(time) {
			if (!state.day) { return time; }
			var match = state.day.slots.filter(function (s) { return s.time === time; })[0];
			return match ? match.label : time;
		}

		/* ---- steps ---- */

		function paintSteps() {
			var items = [
				{ n: 1, t: 'Pick a date', done: !!state.date },
				{ n: 2, t: 'Pick a time', done: !!state.time },
				{ n: 3, t: 'Your details', done: false }
			];
			var current = state.time ? 3 : (state.date ? 2 : 1);
			el.steps.innerHTML = items.map(function (i) {
				var cls = 'bbb-step' + (i.n === current ? ' is-now' : (i.done ? ' is-done' : ''));
				return '<span class="' + cls + '"><span class="bbb-step-n">' + i.n + '</span><b>' + i.t + '</b></span>';
			}).join('');
		}

		/* ---- submit ---- */

		el.form.addEventListener('submit', function (ev) {
			ev.preventDefault();
			if (state.busy) { return; }

			var f = el.form;
			var payload = {
				name: val(f, 'name'),
				phone: val(f, 'phone'),
				email: val(f, 'email'),
				service: val(f, 'service'),
				notes: val(f, 'notes'),
				consent: f.elements.namedItem('consent').checked ? 1 : 0,
				company: val(f, 'company'),
				opened: state.opened,
				date: state.date,
				time: state.time,
				page: C.page || location.href
			};

			clearFieldErrors(f);
			hideAlert();

			var btn = f.querySelector('[data-bbb="submit"]');
			state.busy = true;
			btn.disabled = true;
			btn.textContent = 'Holding your slot…';

			api('/book', { method: 'POST', body: payload })
				.then(function (res) { showDone(res); })
				.catch(function (e) {
					if (e.status === 409) {
						// Someone else took it between the click and the submit.
						showAlert(e.message, 'err');
						pickDate(state.date);
					} else {
						showAlert(e.message, 'err');
						if (e.field) { markField(f, e.field); }
					}
				})
				.then(function () {
					state.busy = false;
					btn.disabled = false;
					btn.textContent = 'Confirm this appointment';
				});
		});

		function showDone(res) {
			el.body.hidden = true;
			el.done.hidden = false;

			el.done.innerHTML =
				'<div class="bbb-tick" aria-hidden="true">✓</div>' +
				'<h3>Your slot is held</h3>' +
				'<p>' + esc(res.message || C.note || '') + '</p>' +
				'<div class="bbb-receipt">' +
					row('Reference', res.reference) +
					row('Date', res.dateLabel) +
					row('Time', res.timeLabel) +
					row('Clinic', C.address || '') +
				'</div>' +
				'<div class="bbb-actions">' +
					'<a class="bbb-btn bbb-btn-p" data-bbb="ics" href="#" download="appointment.ics">Add to my calendar</a>' +
					(C.whatsapp ? '<a class="bbb-btn bbb-btn-s" target="_blank" rel="noopener" href="https://wa.me/' + esc(C.whatsapp) + '?text=' + encodeURIComponent('Hello, I have booked an appointment. Reference ' + res.reference) + '">Message the clinic</a>' : '') +
				'</div>' +
				'<p class="bbb-note">Please keep your reference. Call ' + esc(C.phone || '') + ' if anything changes.</p>';

			var link = el.done.querySelector('[data-bbb="ics"]');
			if (link && res.startUtc) {
				link.setAttribute('href', icsUrl(res));
				link.setAttribute('download', res.reference + '.ics');
			} else if (link) {
				link.parentNode.removeChild(link);
			}

			try { root.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* noop */ }
		}

		function row(k, v) {
			return '<div><span>' + esc(k) + '</span><span>' + esc(v) + '</span></div>';
		}

		function icsUrl(res) {
			var lines = [
				'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Braces and Beyond//Booking//EN',
				'BEGIN:VEVENT',
				'UID:' + res.reference,
				'DTSTAMP:' + res.startUtc,
				'DTSTART:' + res.startUtc,
				'DTEND:' + res.endUtc,
				'SUMMARY:' + (C.clinic || 'Dental appointment'),
				'DESCRIPTION:Reference ' + res.reference,
				'LOCATION:' + String(C.address || '').replace(/,/g, '\\,'),
				'END:VEVENT', 'END:VCALENDAR'
			];
			return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
		}

		function showAlert(msg, kind) {
			el.alert.className = 'bbb-alert is-on bbb-alert-' + (kind === 'err' ? 'err' : 'info');
			el.alert.textContent = msg;
		}
		function hideAlert() { el.alert.className = 'bbb-alert'; el.alert.textContent = ''; }
	}

	/* markup ------------------------------------------------------------- */

	function shell(title) {
		return '' +
		'<div class="bbb-card">' +
			'<div data-bbb="body">' +
				'<div class="bbb-head">' +
					'<div>' +
						'<h2>' + esc(title) + '</h2>' +
						'<span class="bbb-bar"></span>' +
						'<p class="bbb-lede">Choose a date, then a time that suits you. Anything already taken disappears from the calendar, so every slot you can see is genuinely free.</p>' +
					'</div>' +
				'</div>' +

				'<div class="bbb-steps" data-bbb="steps"></div>' +

				'<div class="bbb-cal">' +
					'<div class="bbb-cal-top">' +
						'<span class="bbb-month" data-bbb="month" aria-live="polite">&nbsp;</span>' +
						'<span class="bbb-nav">' +
							'<button type="button" data-bbb="prev" aria-label="Previous month">‹</button>' +
							'<button type="button" data-bbb="next" aria-label="Next month">›</button>' +
						'</span>' +
					'</div>' +
					'<div class="bbb-dow" aria-hidden="true">' + DOW.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>' +
					'<div class="bbb-grid" data-bbb="grid" role="group" aria-label="Choose an appointment date"></div>' +
					'<div class="bbb-legend">' +
						'<span><i class="bbb-key"></i> Available</span>' +
						'<span><i class="bbb-key full"></i> Fully booked</span>' +
						'<span><i class="bbb-key closed"></i> Closed</span>' +
					'</div>' +
				'</div>' +

				'<div class="bbb-slots" data-bbb="slots" aria-live="polite" hidden></div>' +

				'<form class="bbb-form" data-bbb="form" novalidate hidden>' +
					'<h3 style="margin:0 0 4px;font:400 18px/1.3 Helvetica,Arial,sans-serif;color:#3E4530">Your details</h3>' +
					'<p class="bbb-slots-sub">Booking <strong data-bbb="chosen"></strong></p>' +
					'<div class="bbb-fields">' +
						field('name', 'Patient name', 'text', true, 'As it should appear on the record') +
						field('phone', 'Mobile number', 'tel', true, 'Reception will call this number to confirm') +
						field('email', 'Email address', 'email', !!C.requireMail, C.requireMail ? '' : 'Optional, for your written confirmation') +
						serviceField() +
						'<div class="bbb-field is-wide">' +
							'<label for="bbb-notes">Anything we should know</label>' +
							'<textarea id="bbb-notes" name="notes" rows="3" placeholder="Previous treatment, a concern, a preferred clinician"></textarea>' +
						'</div>' +
					'</div>' +
					'<label class="bbb-consent"><input type="checkbox" name="consent" value="1"> <span>I agree that the clinic may contact me by phone, WhatsApp or email about this appointment.</span></label>' +
					'<div class="bbb-hp" aria-hidden="true"><label>Company<input type="text" name="company" tabindex="-1" autocomplete="off"></label></div>' +
					'<div class="bbb-alert" data-bbb="alert" role="alert"></div>' +
					'<div class="bbb-actions">' +
						'<button type="submit" class="bbb-btn bbb-btn-p" data-bbb="submit">Confirm this appointment</button>' +
						(C.phone ? '<a class="bbb-btn bbb-btn-s" href="tel:' + esc(String(C.phone).replace(/[^\d+]/g, '')) + '">Call ' + esc(C.phone) + '</a>' : '') +
					'</div>' +
					'<p class="bbb-note">Your slot is held as soon as you submit this form. Reception confirms every booking before your visit.</p>' +
				'</form>' +
			'</div>' +
			'<div class="bbb-done" data-bbb="done" hidden></div>' +
		'</div>';
	}

	function field(name, label, type, required, hint) {
		return '<div class="bbb-field' + (name === 'notes' ? ' is-wide' : '') + '" data-field="' + name + '">' +
			'<label for="bbb-' + name + '">' + esc(label) + (required ? ' *' : '') + '</label>' +
			'<input id="bbb-' + name + '" name="' + name + '" type="' + type + '"' +
			(name === 'phone' ? ' inputmode="tel" placeholder="0319 9911941"' : '') +
			(name === 'name' ? ' autocomplete="name"' : '') +
			(name === 'email' ? ' autocomplete="email"' : '') +
			'>' +
			(hint ? '<p class="bbb-hint">' + esc(hint) + '</p>' : '') +
			'</div>';
	}

	function serviceField() {
		var list = C.services || [];
		var options = ['<option value="">Choose one</option>'].concat(list.map(function (s) {
			return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
		})).join('');
		return '<div class="bbb-field" data-field="service">' +
			'<label for="bbb-service">Reason for visit</label>' +
			'<select id="bbb-service" name="service">' + options + '</select>' +
			'</div>';
	}

	/* ------------------------------------------------------------------ *
	 * enquiry widget
	 * ------------------------------------------------------------------ */

	function mountEnquiry(root) {

		if (root.getAttribute('data-bbb-ready')) { return; }
		root.setAttribute('data-bbb-ready', '1');

		var title = root.getAttribute('data-bb-title') || 'Send us a message';
		var opened = Date.now();
		var busy = false;

		root.className = ((root.className || '') + ' bbb').trim();
		root.innerHTML = '' +
		'<div class="bbb-card">' +
			'<div data-bbb="body">' +
				'<h2>' + esc(title) + '</h2>' +
				'<span class="bbb-bar"></span>' +
				'<p class="bbb-lede">For anything that is not an appointment: a question about treatment, records, or a second opinion.</p>' +
				'<form class="bbb-form" data-bbb="form" novalidate style="border-top:none;padding-top:18px;margin-top:6px">' +
					'<div class="bbb-fields">' +
						field('name', 'Your name', 'text', true, '') +
						field('email', 'Email address', 'email', true, 'We reply to this address') +
						field('phone', 'Mobile number', 'tel', false, 'Optional') +
						'<div class="bbb-field" data-field="subject">' +
							'<label for="bbb-subject">Subject</label>' +
							'<input id="bbb-subject" name="subject" type="text" placeholder="What is this about">' +
						'</div>' +
						'<div class="bbb-field is-wide" data-field="message">' +
							'<label for="bbb-message">Message *</label>' +
							'<textarea id="bbb-message" name="message" rows="5"></textarea>' +
						'</div>' +
					'</div>' +
					'<label class="bbb-consent"><input type="checkbox" name="consent" value="1"> <span>I agree that the clinic may use these details to reply to my message.</span></label>' +
					'<div class="bbb-hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>' +
					'<div class="bbb-alert" data-bbb="alert" role="alert"></div>' +
					'<div class="bbb-actions"><button type="submit" class="bbb-btn bbb-btn-p" data-bbb="submit">Send message</button></div>' +
				'</form>' +
			'</div>' +
			'<div class="bbb-done" data-bbb="done" hidden></div>' +
		'</div>';

		var form = root.querySelector('[data-bbb="form"]');
		var alertBox = root.querySelector('[data-bbb="alert"]');
		var body = root.querySelector('[data-bbb="body"]');
		var done = root.querySelector('[data-bbb="done"]');

		form.addEventListener('submit', function (ev) {
			ev.preventDefault();
			if (busy) { return; }

			clearFieldErrors(form);
			alertBox.className = 'bbb-alert';

			var btn = form.querySelector('[data-bbb="submit"]');
			busy = true;
			btn.disabled = true;
			btn.textContent = 'Sending…';

			api('/enquiry', {
				method: 'POST',
				body: {
					name: val(form, 'name'),
					email: val(form, 'email'),
					phone: val(form, 'phone'),
					subject: val(form, 'subject'),
					message: val(form, 'message'),
					consent: form.elements.namedItem('consent').checked ? 1 : 0,
					website: val(form, 'website'),
					opened: opened,
					page: C.page || location.href
				}
			}).then(function (res) {
				body.hidden = true;
				done.hidden = false;
				done.innerHTML = '<div class="bbb-tick" aria-hidden="true">✓</div><h3>Message sent</h3><p>' + esc(res.message) + '</p>';
			}).catch(function (e) {
				alertBox.className = 'bbb-alert is-on bbb-alert-err';
				alertBox.textContent = e.message;
				if (e.field) { markField(form, e.field); }
			}).then(function () {
				busy = false;
				btn.disabled = false;
				btn.textContent = 'Send message';
			});
		});
	}

	/* ------------------------------------------------------------------ *
	 * shared form helpers
	 * ------------------------------------------------------------------ */

	function val(form, name) {
		var node = form.elements.namedItem(name);
		return node ? String(node.value || '').trim() : '';
	}

	function markField(form, name) {
		var wrap = form.querySelector('[data-field="' + name + '"]');
		if (wrap) {
			wrap.classList.add('has-error');
			var input = wrap.querySelector('input, select, textarea');
			if (input) { input.focus(); }
		}
	}

	function clearFieldErrors(form) {
		Array.prototype.forEach.call(form.querySelectorAll('.has-error'), function (n) {
			n.classList.remove('has-error');
		});
	}

	/* ------------------------------------------------------------------ *
	 * boot
	 * ------------------------------------------------------------------ */

	function boot() {
		Array.prototype.forEach.call(document.querySelectorAll('[data-bb-booking]'), mountBooking);
		Array.prototype.forEach.call(document.querySelectorAll('[data-bb-enquiry]'), mountEnquiry);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}

	// Elementor popups and lazy sections can inject the container later.
	window.BBBMount = boot;
	document.addEventListener('elementor/popup/show', boot);
})();
