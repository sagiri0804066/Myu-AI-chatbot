const DEFAULT_PROFILE = {
    nickname: 'User',
    avatar: null,
    org: '',
    gender: '',
    birthday: '',
    hobbies: '',
    background: '',
};

export const momentsStore = {
    profile: { ...DEFAULT_PROFILE },
    moments: [],
    notifications: [],
    activeMomentUuid: null,
    selectedPostImages: [],
    isLoadingMore: false,
    hasMore: true,

    setProfile(profile) {
        this.profile = {
            ...DEFAULT_PROFILE,
            ...(profile && typeof profile === 'object' ? profile : {}),
        };
    },

    setMoments(moments) {
        this.moments = Array.isArray(moments) ? moments : [];
    },

    appendMoments(moments) {
        if (!Array.isArray(moments)) return;

        const existing = new Set(
            this.moments.map(moment => String(moment.uuid || moment.id))
        );

        moments.forEach(moment => {
            const key = String(moment?.uuid || moment?.id || '');
            if (!key || existing.has(key)) return;

            existing.add(key);
            this.moments.push(moment);
        });
    },

    removeMoment(uuid) {
        this.moments = this.moments.filter(
            moment => String(moment.uuid) !== String(uuid)
        );
    },

    setNotifications(notifications) {
        this.notifications = Array.isArray(notifications)
            ? notifications
            : [];
    },

    setActiveMoment(uuid) {
        this.activeMomentUuid = uuid ? String(uuid) : null;
    },

    clearActiveMoment() {
        this.activeMomentUuid = null;
    },

    addPostImage(image) {
        if (typeof image === 'string' && image) {
            this.selectedPostImages.push(image);
        }
    },

    removePostImage(index) {
        if (
            Number.isInteger(index) &&
            index >= 0 &&
            index < this.selectedPostImages.length
        ) {
            this.selectedPostImages.splice(index, 1);
        }
    },

    clearPostImages() {
        this.selectedPostImages = [];
    },

    resetPagination() {
        this.isLoadingMore = false;
        this.hasMore = true;
    },
};
