/**
 * Feed Manager Admin JavaScript
 *
 * @package   FeedManager
 * @author    Chris Voll + Upstatement
 * @license   GPL-2.0+
 * @link      http://upstatement.com
 * @copyright 2014 Upstatement
 */

jQuery(function($) {

  // Setup
  var $feed = $('.fm-posts');


  ////////////////////////////////////////////
  // 
  // Heartbeat
  //
  // Avoid feed collisions by loading feed
  // updates from the database. For the purpose
  // of more accurate placements, pinned posts
  // are excluded from the list of IDs that
  // are passed around.
  // 
  ////////////////////////////////////////////

  // Listen for the custom event "heartbeat-tick" on $(document).
  var tmp_ids    = $feed.attr('data-ids');
  var tmp_pinned = $feed.attr('data-pinned');

  $(document).on( 'heartbeat-tick', function(e, data) {

    if ( data.fm_feed_ids !== $feed.attr('data-ids') || data.fm_feed_pinned !== $feed.attr('data-pinned') ) {
      tmp_ids = data.fm_feed_ids;
      tmp_pinned = data.fm_feed_pinned;

      var front = $feed.attr('data-ids').split(',');
      var back  = data.fm_feed_ids.split(',');

      var front_pinned = $feed.attr('data-pinned').split(',');
      var back_pinned  = data.fm_feed_pinned.split(',');

      // Published posts
      for (i in back) {
        if ( $.inArray(back[i], front) < 0 ) {
          post_queue.insert(back[i], i);
        }
      }

      // Deleted posts
      for (i in front) {
        if ( $.inArray(front[i], back) < 0 ) {
          post_queue.remove(front[i]);
        }
      }

      // Deleted pinned posts
      for (i in front_pinned) {
        if ( $.inArray(front_pinned[i], back_pinned) < 0 ) {
          post_queue.remove(front_pinned[i]);
        }
      }
    }
  });


  ////////////////////////////////////////////
  // 
  // Post Manipulation
  // 
  ////////////////////////////////////////////

  // Pin Post
  var pin_post = function(e) {
    e.preventDefault();

    var stub = $(this);
    if (!stub.hasClass('stub')) stub = $(this).closest('.stub');

    if ( stub.hasClass('fm-pinned') ) {
      stub.removeClass('fm-pinned');
      stub.find('.fm-pin-checkbox').prop('checked', false);
    } else {
      stub.addClass('fm-pinned');
      stub.find('.fm-pin-checkbox').prop('checked', true);
    }
  };

  // (by clicking the pin, or double clicking on the stub)
  $('.fm-posts').on('click',    '.pin-unpin', pin_post);
  $('.fm-posts').on('dblclick', '.stub',      pin_post);


  // Remove Post
  var remove_post = function(e) {
    e.preventDefault();

    var id = $(this).closest('.stub').attr('data-id');
    post_queue.remove_single(id);
  };

  $('.fm-posts').on('click', '.remove', remove_post);


  // Reorder Post
  $('.fm-posts').sortable({
    start: function (event, ui) {
      if (ui.item.hasClass('fm-pinned')) return;
      $(document).trigger('fm/sortable_start', ui.item);
      $(ui.placeholder).height($(ui.item).height());
      post_queue.sort_inventory_pinned();
    },
    change: function (event, ui) {
      if (ui.item.hasClass('fm-pinned')) return;
      post_queue.sort_remove_pinned();
      post_queue.sort_insert_pinned();
    },
    axis: 'y'
  });


  ////////////////////////////////////////////
  // 
  // Post insertion queue
  //
  // Provides a general API for use by the
  // collision management system (heartbeat)
  // and search feature.
  //
  // See the UI in the next section.
  //
  // NOTE: This whole thing is due for a rewrite.
  //
  // -----------------------------------------
  //
  // Queue usage:
  // - post_queue.insert( post_id, position0 );
  // - post_queue.remove( post_id );
  //
  // Apply changes:
  // - post_queue.retrieve_posts();
  //
  // Add a single post without invoking the queues:
  // - post_queue.retrieve_posts({ [post_id]: [position0] }, false);
  // 
  ////////////////////////////////////////////

  var post_queue = {

    queue: {},
    remove_queue: {},

    /**
     * Add a post to the queue.
     * If it already exists, update the position
     */
    insert: function (id, position) {
      // Verify that it doesn't already exist
      if ( $feed.find('#post-' + id).length) return;

      this.queue[id] = position;
      $(document).trigger('fm/post_queue_update', [ this.queue, this.remove_queue ]);
    },

    /**
     * Queue up a post for removal
     */
    remove: function (id) {
      // Verify that it exists
      if ( !$feed.find('#post-' + id).length) return;

      this.remove_queue[id] = id;
      $(document).trigger('fm/post_queue_update', [ this.queue, this.remove_queue ]);
    },

    /**
     * Retrieve rendered post stubs HTML from the database
     *
     * - queue: optional, override the built-in queue. Useful
     *          for inserting single posts (e.g., from search).
     *          Set to false to not insert posts from the queue.
     * - remove_queue: optional, override built-in removal queue.
     *          Set to false to not remove posts from the queue.
     *
     * @TODO: this is really weird/hacky, needs to be rewritten
     */
    retrieve_posts: function (queue, remove_queue) {
      $(document).trigger('fm/post_queue_updating');

      if ( queue === null ) queue = this.queue;
      if ( remove_queue === null ) remove_queue = this.remove_queue;

      if ( queue !== false && _.keys(queue).length > 0 ) {
        var request = {
          action: 'fm_feed_request',
          queue: queue
        };

        var that = this;

        $.post(ajaxurl, request, function (response) {
          var data = JSON.parse(response);
          if ( data.status && data.status == 'error' ) return;
          that.update_feed.call( that, data.data, remove_queue );
          $(document).trigger('fm/post_queue_update', [ that.queue, that.remove_queue ] );
        });
      }
      else if ( remove_queue !== null && _.keys(remove_queue).length > 0 ) {
        this.update_feed.call( this, false, remove_queue );
        $(document).trigger('fm/post_queue_update', [ this.queue, this.remove_queue ] );
      }
    },

    insert_single: function ( id, position ) {
      // Verify that it doesn't already exist
      if ( $feed.find('#post-' + id).length) return;

      var post = {};
      post[id] = position;
      this.retrieve_posts( post, false );
    },

    remove_single: function ( id ) {
      // Verify that it exists
      if ( !$feed.find('#post-' + id).length) return;

      var post = {};
      post[id] = id;
      this.retrieve_posts( false, post );
    },

    /**
     * Inserts/removes posts in feed
     *
     * insert_data: comes from retrieve_posts AJAX
     * remove_queue: comes from retrieve_posts
     *
     * @TODO: Post removal functionality
     * @TODO: Avoid duplication
     */
    update_feed: function (insert_data, remove_queue) {

      this.remove_pinned();

      // Insert new posts
      if ( insert_data ) {
        for ( id in insert_data ) {
          if ( insert_data[id]['object'] ) {
            this.inject( insert_data[id]['position'], insert_data[id]['object'] );
          }
          delete this.queue[id];
        }
      }

      // Remove deleted posts (+ pinned ones)
      if ( remove_queue ) {
        this.delete_pinned( remove_queue );

        for ( id in remove_queue ) {
          $feed.find('#post-' + id).remove();
          delete this.remove_queue[id];
          delete this.pinned_cache[id];
        }
      }

      this.insert_pinned();
    },

    /**
     * Inserts one post into the feed
     */
    inject: function (position, object) {
      if ( position == 0 ) {
        $feed.prepend( object );
      } else {
        $feed.find( '.stub:nth-child(' + position + ')' ).after( object );
      }
    },

    /**
     * Helpers for ensuring pinned items stay in place,
     * and for deleting pinned items altogether
     */
    pinned_cache: [],
    remove_pinned: function () {
      var that = this;
      $feed.find('.stub').each( function (i) {
        if ( $(this).hasClass('fm-pinned') ) {
          var id = $(this).attr('data-id');
          that.pinned_cache.push({
            id: id,
            obj: this,
            position: i
          });
          $(this).remove();
        }
      });
    },
    delete_pinned: function (remove_queue) {
      for (i in this.pinned_cache) {
        if ( remove_queue[ this.pinned_cache[i].id ] ) {
          delete this.remove_queue[ this.pinned_cache[i].id ];
          delete this.pinned_cache[i];
        }
      }
    },
    insert_pinned: function () {
      for (i in this.pinned_cache) {
        this.inject(
          this.pinned_cache[i].position,
          this.pinned_cache[i].obj
        );
      }
      this.pinned_cache = [];
    },


    /**
     * Helpers for keeping pinned stubs in place while
     * sorting items manually.
     */
    pinned_inventory: [],
    sort_inventory_pinned: function () {
      var that = this;
      this.pinned_inventory = [];
      $feed.find('.stub').each( function (i) {
        if ( $(this).hasClass('fm-pinned') ) {
          var id = $(this).attr('data-id');
          that.pinned_inventory.push({
            id: id,
            obj: this,
            position: i
          });
        }
      });
    },
    sort_remove_pinned: function () {
      for (i in this.pinned_inventory) {
        this.pinned_inventory[i].obj.remove();
      }
    },
    sort_insert_pinned: function () {
      for (i in this.pinned_inventory) {
        this.inject(
          this.pinned_inventory[i].position,
          this.pinned_inventory[i].obj
        );
      }
    },

  };

  window.post_queue = post_queue;


  ////////////////////////////////////////////
  // 
  // Post queue UI
  //
  // Listens for the post_queue events to update
  // the user interface, letting the end user
  // know when there are changes.
  // 
  ////////////////////////////////////////////

  var $queue = $('.post-queue-alert');
  var allow_submit = true;

  $(document).on('fm/post_queue_update', function( e, queue, remove_queue ) {
    var queue_length        = _.keys(queue).length;
    var remove_queue_length = _.keys(remove_queue).length;

    if ( (queue_length + remove_queue_length) > 0 ) {
      $queue.show();
      var text = [
        '<span class="dashicons dashicons-plus"></span> '
      ];

      if ( queue_length == 1 ) {
        text.push('There is 1 new post. ');
      } else if ( queue_length > 1 ) {
        text.push('There are ' + queue_length + ' new posts. ');
      }

      if ( remove_queue_length == 1 ) {
        text.push('There is 1 post that was deleted. ');
      } else if ( remove_queue_length > 1 ) {
        text.push('There are ' + remove_queue_length + ' posts that were deleted. ');
      }

      $queue.html(text.join(""));
      allow_submit = false;
    } else {
      $queue.hide();
      allow_submit = true;
    }
  });

  $queue.on('click', function(e) {
    post_queue.retrieve_posts(post_queue.queue, post_queue.remove_queue);
    $feed.attr('data-ids', tmp_ids);
    allow_submit = true;
  });

  // the submit event gets called twice, so keep track with this
  var submit_flag = true;

  $('form#post').off('submit.fm').on('submit.fm', function(e) {
    submit_flag = !submit_flag;
    if ( !submit_flag && !allow_submit ) return;

    if ( !allow_submit ) {
      if ( ! window.confirm('New posts have been published or removed since you began editing the feed. \n\nPress Cancel to go back, or OK to save the feed without them.') ) {
        e.preventDefault();
      } else {
        allow_submit = true;
      }
    }
  });


  ////////////////////////////////////////////
  // 
  // Search
  // 
  ////////////////////////////////////////////

  var search_query = '';
  var search_timer = null;
  var $results = $('.fm-results');

  $('.fm-search').on({
    input: function(e) {
      var that = this;

      clearTimeout(search_timer);
      search_timer = setTimeout(function() {
        if ( $(that).val() !== search_query ) {
          search_query = $(that).val();

          if ( search_query.length > 2 ) {

            var request = {
              action: 'fm_feed_search',
              query: search_query
            };

            $.post(ajaxurl, request, function(results) {
              var data = JSON.parse(results);

              $results.empty();
              $results.show();

              for (i in data.data) {
                var post = data.data[i];
                $results.append('<li><a class="fm-result" href="#" data-id="' + post.id + '">' + post.title + '</a></li>');

                $results.find('li:nth-child(1) .fm-result').addClass('active');
              }
            });
          } else {
            $results.empty();
            $results.hide();
          }
        }
      }, 200);
    },
    keydown: function (e) {
      if (e.keyCode == 38) {
        // up
        e.preventDefault();
        var $active = $results.find('.active');
        var $prev = $active.parent().prev().find('.fm-result');

        if (!$prev.length) return;

        $active.removeClass('active');
        $prev.addClass('active');
      } else if (e.keyCode == 40) {
        // down
        e.preventDefault();
        var $active = $results.find('.active');
        var $next = $active.parent().next().find('.fm-result');

        if (!$next.length) return;

        $active.removeClass('active');
        $next.addClass('active');
      } else if (e.keyCode == 13) {
        // enter
        e.preventDefault();
        $results.find('.active').trigger('fm/select');
      }
    }
  });

  $('.fm-search').on('focus', function(e) {
    if ( !$results.is(':empty') ) {
      $results.show();
    }
  });

  $results.on('mouseover', '.fm-result', function (e) {
    if ( $(this).hasClass('active') ) return;
    $results.find('.active').removeClass('active');
    $(this).addClass('active');
  });

  $results.on('click fm/select', '.fm-result', function (e) {
    e.preventDefault();
    post_queue.insert_single( $(this).attr('data-id'), 0 );
    $results.hide();
  });

  $('body').on('mousedown', function(e) {
    if ( !$(e.target).closest('.fm-search-container').length ) {
      $results.hide();
    }
  });



});

// Remove undo
// @TODO: move this somewhere else
var undo_cache = [];

var undo_remove = function() {
  var object = undo_cache.pop();
  if (!object) return;
  var container = jQuery('.fm-posts');

  if (object.position == 0) {
    container.prepend(object.object);
  } else {
    container.find('.stub:nth-child(' + object.position + ')').after(object.object);
  }
}
