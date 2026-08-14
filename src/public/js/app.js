/* ===========================================================================
   Progressive enhancement only.
   Every feature below is additive: with JavaScript disabled the pages still
   render, every form still submits and every link still navigates.
   No inline script is used anywhere, so the CSP can forbid it outright.
   =========================================================================== */
(function () {
  'use strict';

  var csrfToken = (function () {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  })();

  /* ------------------------------------------------- submit-once guard --- */
  // Stops a double click turning into two booking requests or two messages.
  function guardSubmitOnce() {
    document.addEventListener('submit', function (event) {
      var form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.hasAttribute('data-allow-resubmit')) return;
      var buttons = form.querySelectorAll('[data-submit-once]');
      window.setTimeout(function () {
        for (var i = 0; i < buttons.length; i += 1) {
          var button = buttons[i];
          button.setAttribute('aria-disabled', 'true');
          button.setAttribute('aria-busy', 'true');
          button.disabled = true;
          if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
          button.textContent = 'Working\u2026';
        }
      }, 0);

      // If the browser restores the page from cache (back button), re-enable.
      window.addEventListener(
        'pageshow',
        function () {
          for (var j = 0; j < buttons.length; j += 1) {
            var b = buttons[j];
            b.disabled = false;
            b.removeAttribute('aria-disabled');
            b.removeAttribute('aria-busy');
            if (b.dataset.originalLabel) b.textContent = b.dataset.originalLabel;
          }
        },
        { once: true }
      );
    });
  }

  /* --------------------------------------------------- character counter -- */
  function attachCounters() {
    var fields = document.querySelectorAll('textarea[data-counter]');
    Array.prototype.forEach.call(fields, function (field) {
      var max = Number(field.getAttribute('maxlength') || 0);
      if (!max) return;
      var counter = document.createElement('p');
      counter.className = 'counter';
      counter.setAttribute('aria-live', 'polite');
      var update = function () {
        counter.textContent = field.value.length + ' / ' + max + ' characters';
      };
      update();
      field.insertAdjacentElement('afterend', counter);
      field.addEventListener('input', update);
    });
  }

  /* ------------------------------------------------------ relative time -- */
  function relativeLabel(iso) {
    var target = new Date(iso).getTime();
    if (isNaN(target)) return null;
    var diff = Math.round((target - Date.now()) / 1000);
    var past = diff < 0;
    var seconds = Math.abs(diff);
    if (seconds < 45) return past ? 'just now' : 'in a moment';
    var units = [
      ['minute', 60],
      ['hour', 3600],
      ['day', 86400],
      ['week', 604800],
      ['month', 2592000],
      ['year', 31536000],
    ];
    var label = 'year';
    var amount = Math.round(seconds / 31536000);
    for (var i = 0; i < units.length; i += 1) {
      var next = units[i + 1];
      if (!next || seconds < next[1]) {
        label = units[i][0];
        amount = Math.max(1, Math.round(seconds / units[i][1]));
        break;
      }
    }
    var text = amount + ' ' + label + (amount === 1 ? '' : 's');
    return past ? text + ' ago' : 'in ' + text;
  }

  function refreshRelativeTimes() {
    var nodes = document.querySelectorAll('time[data-relative]');
    Array.prototype.forEach.call(nodes, function (node) {
      var label = relativeLabel(node.getAttribute('datetime'));
      if (label) node.textContent = label;
    });
  }

  /* ------------------------------------------------- notification badge -- */
  function pollNotificationBadge() {
    var badge = document.querySelector('[data-notification-badge]');
    if (!badge) return;
    var run = function () {
      fetch('/api/notifications/unread-count', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      })
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .then(function (data) {
          if (!data || typeof data.count !== 'number') return;
          badge.textContent = String(data.count);
          badge.classList.toggle('is-hidden', data.count === 0);
          // Keep the accessible name in step with the visual badge.
          var link = badge.closest('[data-notification-link]');
          if (link) {
            link.setAttribute(
              'aria-label',
              data.count > 0 ? 'Notifications: ' + data.count + ' unread' : 'Notifications: none unread'
            );
          }
        })
        .catch(function () {
          /* offline or logged out: leave the server-rendered value alone */
        });
    };
    window.setInterval(run, 60000);
  }

  /* --------------------------------------------------- filter disclosure -- */
  // The filter panel is rendered open so it works with scripting disabled.
  // On small screens we collapse it so results are the first thing seen, and
  // reopen it automatically if the viewport grows.
  function attachFilterPanel() {
    var panel = document.querySelector('[data-filter-panel]');
    if (!panel) return;
    var small = window.matchMedia('(max-width: 900px)');
    var touchedByUser = false;

    panel.addEventListener('toggle', function () {
      touchedByUser = true;
    });

    var apply = function () {
      if (touchedByUser) return;
      if (small.matches) panel.removeAttribute('open');
      else panel.setAttribute('open', '');
    };

    apply();
    if (small.addEventListener) small.addEventListener('change', apply);
  }

  /* -------------------------------------------------------- filter form -- */
  // Submitting on change keeps filter state in the URL (shareable, back-safe).
  function attachAutoSubmit() {
    var forms = document.querySelectorAll('form[data-autosubmit]');
    Array.prototype.forEach.call(forms, function (form) {
      var controls = form.querySelectorAll('select');
      Array.prototype.forEach.call(controls, function (control) {
        control.addEventListener('change', function () {
          form.submit();
        });
      });
    });
  }

  /* ------------------------------------------------------ message thread -- */
  function initThread() {
    var thread = document.querySelector('[data-thread]');
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;

    var conversationId = thread.getAttribute('data-thread');
    var lastId = Number(thread.getAttribute('data-last-id') || 0);

    function append(message) {
      var bubble = document.createElement('div');
      bubble.className = 'bubble' + (message.mine ? ' bubble--mine' : '');
      var text = document.createElement('span');
      text.textContent = message.body; // textContent: never interpreted as HTML
      var meta = document.createElement('span');
      meta.className = 'bubble__meta';
      meta.textContent = message.sender_name + ' \u00b7 ' + (relativeLabel(message.created_at) || '');
      bubble.appendChild(text);
      bubble.appendChild(meta);
      thread.appendChild(bubble);
    }

    function poll() {
      fetch('/api/conversations/' + encodeURIComponent(conversationId) + '/messages?after=' + lastId, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      })
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .then(function (data) {
          if (!data || !Array.isArray(data.messages) || data.messages.length === 0) return;
          var wasAtBottom = thread.scrollTop + thread.clientHeight >= thread.scrollHeight - 40;
          data.messages.forEach(function (message) {
            append(message);
            if (message.id > lastId) lastId = message.id;
          });
          thread.setAttribute('data-last-id', String(lastId));
          if (wasAtBottom) thread.scrollTop = thread.scrollHeight;
        })
        .catch(function () {
          /* transient failure: the next tick tries again */
        });
    }

    window.setInterval(poll, 15000);
  }

  /* ------------------------------------------------- close open details -- */
  // Clicking outside an open account menu should close it, like a real menu.
  function closeMenusOnOutsideClick() {
    document.addEventListener('click', function (event) {
      var menus = document.querySelectorAll('details.menu[open]');
      Array.prototype.forEach.call(menus, function (menu) {
        if (!menu.contains(event.target)) menu.removeAttribute('open');
      });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      var menus = document.querySelectorAll('details.menu[open]');
      Array.prototype.forEach.call(menus, function (menu) {
        menu.removeAttribute('open');
        var trigger = menu.querySelector('summary');
        if (trigger) trigger.focus();
      });
    });
  }

  function init() {
    guardSubmitOnce();
    attachCounters();
    refreshRelativeTimes();
    window.setInterval(refreshRelativeTimes, 60000);
    pollNotificationBadge();
    attachFilterPanel();
    attachAutoSubmit();
    initThread();
    closeMenusOnOutsideClick();
    void csrfToken; // reserved for future JSON mutations from the client
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
